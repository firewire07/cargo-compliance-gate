import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  EventEnvelope,
  SHIPMENT_EVENTS_TOPIC,
  SHIPMENT_SUBMITTED,
  buildEventEnvelope,
  logLine,
  resolveCorrelationId,
} from '@cargo-compliance-gate/contracts';
import {
  PartyRole,
  Prisma,
  Shipment,
  ShipmentStatus,
} from '../../generated/prisma';
import { AuditService } from '../audit/audit.service';
import type { ShipmentEnv } from '../config/env';
import { EXPECTED_CHECKS, holdTimeoutSeconds } from '../hold/hold.aggregator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { hashRequestBody } from './idempotency';

export type ShipmentSubmittedPayload = {
  awb: string;
  origin: string;
  destination: string;
  pieces: number;
  weight: number;
  goodsDescription: string;
  hsCode?: string;
  unNumber?: string;
  routing: string;
  shipper: { name: string; country: string };
  consignee: { name: string; country: string };
};

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<ShipmentEnv, true>,
  ) {}

  async create(
    dto: CreateShipmentDto,
    correlationId?: string,
    idempotencyKey?: string,
  ) {
    // Resolve once so the outbox row, pending check and log line share one ID.
    const corr = resolveCorrelationId(correlationId);
    const key = idempotencyKey?.trim();
    const shipment = key
      ? await this.createIdempotent(dto, corr, key)
      : await this.createNew(dto, corr);
    this.logger.log(
      logLine('shipment.submitted', {
        correlationId: corr,
        awb: dto.awb,
        idempotent: Boolean(key),
      }),
    );
    return shipment;
  }

  private async createIdempotent(
    dto: CreateShipmentDto,
    correlationId: string | undefined,
    key: string,
  ) {
    const requestHash = hashRequestBody(dto);
    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { key },
    });
    if (existing) {
      this.assertSameBody(existing.requestHash, requestHash);
      return existing.response as unknown as Shipment;
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const shipment = await this.persistNewShipment(tx, dto, correlationId);
        await tx.idempotencyKey.create({
          data: {
            key,
            requestHash,
            statusCode: 202,
            response: shipment as unknown as Prisma.InputJsonValue,
          },
        });
        return shipment;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const raced = await this.prisma.idempotencyKey.findUnique({
          where: { key },
        });
        if (raced) {
          this.assertSameBody(raced.requestHash, requestHash);
          return raced.response as unknown as Shipment;
        }
        throw new ConflictException(`Shipment ${dto.awb} already exists`);
      }
      throw err;
    }
  }

  private assertSameBody(storedHash: string, requestHash: string): void {
    if (storedHash !== requestHash) {
      throw new ConflictException(
        'Idempotency-Key was reused with a different request body',
      );
    }
  }

  private async createNew(dto: CreateShipmentDto, correlationId?: string) {
    try {
      return await this.prisma.$transaction(async (tx) =>
        this.persistNewShipment(tx, dto, correlationId),
      );
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(`Shipment ${dto.awb} already exists`);
      }
      throw err;
    }
  }

  private async persistNewShipment(
    tx: Prisma.TransactionClient,
    dto: CreateShipmentDto,
    correlationId?: string,
  ): Promise<Shipment> {
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    const corr = resolveCorrelationId(correlationId);
    const shipmentVersion = 1;
    const envelope: EventEnvelope<ShipmentSubmittedPayload> = buildEventEnvelope({
      id: eventId,
      type: SHIPMENT_SUBMITTED,
      occurredAt,
      correlationId: corr,
      awb: dto.awb,
      shipmentVersion,
      payload: {
        awb: dto.awb,
        origin: dto.origin,
        destination: dto.destination,
        pieces: dto.pieces,
        weight: dto.weight,
        goodsDescription: dto.goodsDescription,
        hsCode: dto.hsCode,
        unNumber: dto.unNumber,
        routing: dto.routing,
        shipper: { name: dto.shipper.name, country: dto.shipper.country },
        consignee: {
          name: dto.consignee.name,
          country: dto.consignee.country,
        },
      },
    });

const shipment = await tx.shipment.create({
  data: {
    awb: dto.awb,
    origin: dto.origin,
    destination: dto.destination,
    pieces: dto.pieces,
    weight: dto.weight,
    goodsDescription: dto.goodsDescription,
    hsCode: dto.hsCode,
    unNumber: dto.unNumber,
    routing: dto.routing,
    status: ShipmentStatus.CHECKING,
    version: shipmentVersion,
    parties: {
      create: [
        {
          role: PartyRole.SHIPPER,
          name: dto.shipper.name,
          country: dto.shipper.country,
        },
        {
          role: PartyRole.CONSIGNEE,
          name: dto.consignee.name,
          country: dto.consignee.country,
        },
      ],
    },
  },
  include: { parties: true },
});

await tx.outbox.create({
  data: {
    id: eventId,
    aggregateId: dto.awb,
    type: SHIPMENT_SUBMITTED,
    topic: SHIPMENT_EVENTS_TOPIC,
    payload: envelope as unknown as Prisma.InputJsonValue,
    correlationId: corr,
  },
});

const timeoutSec = holdTimeoutSeconds(this.config.get('HOLD_TIMEOUT_SECONDS', { infer: true }));
await tx.pendingCheck.create({
  data: {
    awb: dto.awb,
    shipmentVersion,
    expected: [...EXPECTED_CHECKS],
    received: [],
    deadline: new Date(Date.now() + timeoutSec * 1000),
    correlationId: corr,
  },
});

await this.audit.append(tx, {
  eventId,
  type: SHIPMENT_SUBMITTED,
  awb: dto.awb,
  actor: 'system',
  ts: occurredAt,
  payload: envelope.payload,
});

return shipment;
  }

  async list(): Promise<Shipment[]> {
    return this.prisma.shipment.findMany({
      include: { parties: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async findByAwb(awb: string): Promise<Shipment> {
    const shipment = await this.prisma.shipment.findUnique({
      where: { awb },
      include: { parties: true },
    });
    if (!shipment) {
      throw new NotFoundException(`Shipment ${awb} not found`);
    }
    return shipment;
  }
}

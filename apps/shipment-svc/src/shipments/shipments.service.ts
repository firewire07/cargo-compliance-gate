import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  PartyRole,
  Prisma,
  Shipment,
  ShipmentStatus,
} from '../../generated/prisma';
import { EventEnvelope, SHIPMENT_EVENTS_TOPIC, SHIPMENT_SUBMITTED } from '../events/envelope';
import { EXPECTED_CHECKS, holdTimeoutSeconds } from '../hold/hold.aggregator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';

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
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateShipmentDto, correlationId?: string) {
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    const corr = correlationId?.trim() || randomUUID();
    const shipmentVersion = 1;
    const envelope: EventEnvelope<ShipmentSubmittedPayload> = {
      id: eventId,
      type: SHIPMENT_SUBMITTED,
      schemaVersion: 1,
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
    };

    try {
      return await this.prisma.$transaction(async (tx) => {
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
          },
        });

        const timeoutSec = holdTimeoutSeconds();
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

        return shipment;
      });
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

import { Logger } from '@nestjs/common';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, ShipmentStatus } from '../../generated/prisma';
import { SHIPMENT_SUBMITTED } from '@cargo-compliance-gate/contracts';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { hashRequestBody } from './idempotency';
import { ShipmentsService } from './shipments.service';

const dto: CreateShipmentDto = {
  awb: '020-12345675',
  origin: 'KUL',
  destination: 'AMS',
  pieces: 2,
  weight: 15.5,
  goodsDescription: 'Electronic parts',
  hsCode: '8542.31',
  routing: 'KUL-AMS',
  shipper: { name: 'Acme Forwarding', country: 'MY' },
  consignee: { name: 'Rotterdam Imports', country: 'NL' },
};

describe('ShipmentsService', () => {
  const tx = {
    shipment: { create: jest.fn() },
    outbox: { create: jest.fn() },
    pendingCheck: { create: jest.fn() },
    idempotencyKey: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(),
    shipment: { findUnique: jest.fn(), findMany: jest.fn() },
    idempotencyKey: { findUnique: jest.fn() },
  };

  const audit = { append: jest.fn() };
  let service: ShipmentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) =>
      fn(tx),
    );
    audit.append.mockResolvedValue(undefined);
    const config = {
      get: (key: string) => (key === 'HOLD_TIMEOUT_SECONDS' ? 30 : undefined),
    };
    service = new ShipmentsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      config as never,
    );
  });

  it('creates the shipment, parties and outbox row in one transaction', async () => {
    const created = { id: 'shp-1', awb: dto.awb, version: 1, parties: [] };
    tx.shipment.create.mockResolvedValue(created);
    tx.outbox.create.mockResolvedValue({ id: 'evt-1' });
    tx.pendingCheck.create.mockResolvedValue({ id: 'pend-1' });

    const result = await service.create(dto, 'corr-123');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.shipment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          awb: dto.awb,
          origin: dto.origin,
          destination: dto.destination,
          pieces: 2,
          weight: 15.5,
          goodsDescription: dto.goodsDescription,
          hsCode: dto.hsCode,
          routing: dto.routing,
          status: ShipmentStatus.CHECKING,
          version: 1,
          parties: {
            create: [
              {
                role: 'SHIPPER',
                name: dto.shipper.name,
                country: dto.shipper.country,
              },
              {
                role: 'CONSIGNEE',
                name: dto.consignee.name,
                country: dto.consignee.country,
              },
            ],
          },
        }),
        include: { parties: true },
      }),
    );

    const outboxArg = tx.outbox.create.mock.calls[0][0];
    expect(outboxArg.data.aggregateId).toBe(dto.awb);
    expect(outboxArg.data.type).toBe(SHIPMENT_SUBMITTED);
    expect(outboxArg.data.id).toEqual(expect.any(String));
    expect(outboxArg.data.payload).toEqual(
      expect.objectContaining({
        id: outboxArg.data.id,
        type: SHIPMENT_SUBMITTED,
        schemaVersion: 1,
        correlationId: 'corr-123',
        awb: dto.awb,
        shipmentVersion: 1,
        payload: expect.objectContaining({
          awb: dto.awb,
          shipper: dto.shipper,
          consignee: dto.consignee,
        }),
      }),
    );
    expect(outboxArg.data.payload.occurredAt).toEqual(expect.any(String));
    expect(outboxArg.data.topic).toBe('shipment.events');
    expect(outboxArg.data.correlationId).toBe('corr-123');
    expect(tx.pendingCheck.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        awb: dto.awb,
        shipmentVersion: 1,
        expected: ['DG', 'EMBARGO', 'SANCTIONS'],
        correlationId: 'corr-123',
        deadline: expect.any(Date),
      }),
    });
    expect(audit.append).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        type: SHIPMENT_SUBMITTED,
        awb: dto.awb,
        actor: 'system',
      }),
    );
    expect(result).toBe(created);
  });

  it('generates a correlation id when the header is missing', async () => {
    tx.shipment.create.mockResolvedValue({ id: 'shp-1', awb: dto.awb });
    tx.outbox.create.mockResolvedValue({});
    tx.pendingCheck.create.mockResolvedValue({});

    await service.create(dto);

    const envelope = tx.outbox.create.mock.calls[0][0].data.payload;
    expect(envelope.correlationId).toEqual(expect.any(String));
    expect(envelope.correlationId.length).toBeGreaterThan(0);
    // Same generated ID on the outbox column, envelope and pending check.
    expect(tx.outbox.create.mock.calls[0][0].data.correlationId).toBe(
      envelope.correlationId,
    );
    expect(tx.pendingCheck.create.mock.calls[0][0].data.correlationId).toBe(
      envelope.correlationId,
    );
  });

  it('maps a unique constraint error to ConflictException', async () => {
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.create(dto, 'corr-123')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('returns a shipment by AWB and 404s when missing', async () => {
    const row = { id: 'shp-1', awb: dto.awb, parties: [] };
    prisma.shipment.findUnique.mockResolvedValue(row);
    await expect(service.findByAwb(dto.awb)).resolves.toBe(row);

    prisma.shipment.findUnique.mockResolvedValue(null);
    await expect(service.findByAwb('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns the original shipment for the same Idempotency-Key and body', async () => {
    const stored = { id: 'shp-1', awb: dto.awb, status: 'CHECKING', parties: [] };
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      key: 'idem-1',
      requestHash: hashRequestBody(dto),
      response: stored,
    });

    const first = await service.create(dto, 'corr-1', 'idem-1');
    const second = await service.create(dto, 'corr-2', 'idem-1');

    expect(first).toEqual(stored);
    expect(second).toEqual(stored);
    expect(tx.shipment.create).not.toHaveBeenCalled();
    expect(tx.outbox.create).not.toHaveBeenCalled();
  });

  it('rejects the same Idempotency-Key when the body is different', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      key: 'idem-1',
      requestHash: hashRequestBody(dto),
      response: { awb: dto.awb },
    });

    await expect(
      service.create({ ...dto, pieces: 99 }, 'corr-1', 'idem-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.shipment.create).not.toHaveBeenCalled();
  });

  it('stores the key with the first successful create', async () => {
    const created = { id: 'shp-1', awb: dto.awb, version: 1, parties: [] };
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    tx.shipment.create.mockResolvedValue(created);
    tx.outbox.create.mockResolvedValue({});
    tx.pendingCheck.create.mockResolvedValue({});
    tx.idempotencyKey.create.mockResolvedValue({});

    const result = await service.create(dto, 'corr-1', 'idem-new');

    expect(result).toBe(created);
    expect(tx.idempotencyKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: 'idem-new',
        requestHash: hashRequestBody(dto),
        statusCode: 202,
        response: created,
      }),
    });
  });
});

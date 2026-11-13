import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, ShipmentStatus } from '../../generated/prisma';
import { SHIPMENT_SUBMITTED } from '../events/envelope';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
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
  };
  const prisma = {
    $transaction: jest.fn(),
    shipment: { findUnique: jest.fn(), findMany: jest.fn() },
  };

  let service: ShipmentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) =>
      fn(tx),
    );
    service = new ShipmentsService(prisma as unknown as PrismaService);
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
    expect(tx.pendingCheck.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        awb: dto.awb,
        shipmentVersion: 1,
        expected: ['DG', 'EMBARGO', 'SANCTIONS'],
        correlationId: 'corr-123',
        deadline: expect.any(Date),
      }),
    });
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
});

import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  EventEnvelope,
  SHIPMENT_SUBMITTED,
  ShipmentEventPayload,
} from '@cargo-compliance-gate/contracts';
import { ScreeningHandler } from './screening.handler';

const envelope: EventEnvelope<ShipmentEventPayload> = {
  id: 'evt-1',
  type: SHIPMENT_SUBMITTED,
  schemaVersion: 1,
  occurredAt: '2026-11-13T08:00:00.000Z',
  correlationId: 'corr-1',
  awb: '020-12345675',
  shipmentVersion: 1,
  payload: {
    awb: '020-12345675',
    origin: 'KUL',
    destination: 'AMS',
    routing: 'KUL-AMS',
    goodsDescription: 'Electronic parts',
    shipper: { name: 'Acme Forwarding', country: 'MY' },
    consignee: { name: 'Rotterdam Imports', country: 'NL' },
  },
};

describe('ScreeningHandler', () => {
  const tx = {
    processedEvent: { createMany: jest.fn() },
    screeningResult: { create: jest.fn() },
    outbox: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(),
  };

  let handler: ScreeningHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) =>
      fn(tx),
    );
    const config = {
      get: (key: string) => (key === 'SANCTIONS_MODE' ? 'name-only' : undefined),
    };
    handler = new ScreeningHandler(
      prisma as unknown as PrismaService,
      config as never,
    );
  });

  it('writes processed_event, three results and three outbox rows in one transaction', async () => {
    tx.processedEvent.createMany.mockResolvedValue({ count: 1 });
    tx.screeningResult.create.mockResolvedValue({});
    tx.outbox.create.mockResolvedValue({});

    const result = await handler.handle(envelope);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.processedEvent.createMany).toHaveBeenCalledWith({
      data: [{ eventId: 'evt-1' }],
      skipDuplicates: true,
    });
    expect(tx.screeningResult.create).toHaveBeenCalledTimes(3);
    expect(tx.outbox.create).toHaveBeenCalledTimes(3);
    const checks = tx.screeningResult.create.mock.calls.map(
      (call) => call[0].data.check,
    );
    expect(checks).toEqual(['DG', 'EMBARGO', 'SANCTIONS']);
    expect(tx.outbox.create.mock.calls[0][0].data.aggregateId).toBe(
      '020-12345675',
    );
    expect(tx.outbox.create.mock.calls[0][0].data.payload).toEqual(
      expect.objectContaining({
        type: 'screening.checked',
        schemaVersion: 1,
        correlationId: 'corr-1',
        awb: '020-12345675',
        shipmentVersion: 1,
        payload: expect.objectContaining({
          check: 'DG',
          ruleVersion: expect.any(String),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ status: 'processed', eventId: 'evt-1' }),
    );
  });

  it('skips all writes when the event id was already processed', async () => {
    tx.processedEvent.createMany.mockResolvedValue({ count: 0 });

    const result = await handler.handle(envelope);

    expect(tx.screeningResult.create).not.toHaveBeenCalled();
    expect(tx.outbox.create).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'skipped', eventId: 'evt-1' });
  });

  describe('correlation id (T12)', () => {
    beforeEach(() => {
      tx.processedEvent.createMany.mockResolvedValue({ count: 1 });
      tx.screeningResult.create.mockResolvedValue({});
      tx.outbox.create.mockResolvedValue({});
    });

    it('prefers the x-correlation-id Kafka header and stores it on outbox rows and events', async () => {
      await handler.handle(envelope, { 'x-correlation-id': 'corr-header' });

      for (const [call] of tx.outbox.create.mock.calls) {
        expect(call.data.correlationId).toBe('corr-header');
        expect(call.data.payload.correlationId).toBe('corr-header');
      }
    });

    it('falls back to the envelope correlationId when the header is missing', async () => {
      await handler.handle(envelope, {});

      expect(tx.outbox.create.mock.calls[0][0].data.correlationId).toBe('corr-1');
    });

    it('generates one when neither header nor envelope has it', async () => {
      await handler.handle({ ...envelope, correlationId: '' });

      const ids = tx.outbox.create.mock.calls.map(([call]) => call.data.correlationId);
      expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
      expect(new Set(ids).size).toBe(1);
    });

    it('logs a structured line with the correlationId', async () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await handler.handle(envelope, { 'x-correlation-id': 'corr-header' });

      const line = JSON.parse(log.mock.calls.at(-1)?.[0] as string);
      expect(line).toEqual(
        expect.objectContaining({
          event: 'screening.completed',
          correlationId: 'corr-header',
          awb: '020-12345675',
        }),
      );
    });
  });
});

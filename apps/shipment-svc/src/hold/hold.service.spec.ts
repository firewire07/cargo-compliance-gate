import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  EventEnvelope,
  SCREENING_CHECKED,
  ScreeningCheckedPayload,
} from '@cargo-compliance-gate/contracts';
import { AuditService } from '../audit/audit.service';
import { EXPECTED_CHECKS } from './hold.aggregator';
import { HoldService } from './hold.service';

function checked(
  check: string,
  outcome: 'PASS' | 'HIT',
  overrides: Partial<EventEnvelope<ScreeningCheckedPayload>> = {},
): EventEnvelope<ScreeningCheckedPayload> {
  return {
    id: `evt-${check}-${outcome}`,
    type: SCREENING_CHECKED,
    schemaVersion: 1,
    occurredAt: '2026-11-13T10:00:00.000Z',
    correlationId: 'corr-1',
    awb: '020-20000001',
    shipmentVersion: 1,
    payload: { check, outcome, reasons: outcome === 'HIT' ? [`${check} hit`] : [], ruleVersion: 'v1' },
    ...overrides,
  };
}

describe('HoldService', () => {
  const tx = {
    processedEvent: { createMany: jest.fn() },
    shipment: { findUnique: jest.fn(), update: jest.fn() },
    pendingCheck: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    hold: { create: jest.fn() },
    outbox: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(),
    pendingCheck: { findMany: jest.fn(), findUnique: jest.fn() },
  };

  const audit = { append: jest.fn() };
  let service: HoldService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) =>
      fn(tx),
    );
    audit.append.mockResolvedValue(undefined);
    service = new HoldService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
    tx.processedEvent.createMany.mockResolvedValue({ count: 1 });
    tx.shipment.findUnique.mockResolvedValue({
      awb: '020-20000001',
      version: 1,
      status: 'CHECKING',
    });
    tx.shipment.update.mockResolvedValue({});
    tx.pendingCheck.update.mockResolvedValue({});
    tx.hold.create.mockResolvedValue({});
    tx.outbox.create.mockResolvedValue({});
  });

  function openPending(received: unknown[] = []) {
    tx.pendingCheck.findUnique.mockResolvedValue({
      id: 'pend-1',
      awb: '020-20000001',
      shipmentVersion: 1,
      expected: [...EXPECTED_CHECKS],
      received,
      decidedAt: null,
      correlationId: 'corr-1',
    });
  }

  it('clears the shipment once all expected checks have passed', async () => {
    openPending([
      { check: 'DG', outcome: 'PASS', reasons: [], eventId: 'evt-DG-PASS' },
      { check: 'EMBARGO', outcome: 'PASS', reasons: [], eventId: 'evt-EMBARGO-PASS' },
    ]);

    const result = await service.applyScreeningResult(checked('SANCTIONS', 'PASS'));

    expect(result).toEqual({
      status: 'decided',
      awb: '020-20000001',
      decision: 'CLEARED',
    });
    expect(tx.shipment.update).toHaveBeenCalledWith({
      where: { awb: '020-20000001' },
      data: { status: 'CLEARED' },
    });
    expect(tx.hold.create).not.toHaveBeenCalled();
    expect(tx.outbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'shipment.cleared',
          topic: 'hold.events',
          aggregateId: '020-20000001',
        }),
      }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: 'shipment.cleared', awb: '020-20000001', actor: 'system' }),
    );
  });

  it('holds the shipment when a check is a HIT and writes a Hold row', async () => {
    openPending([
      { check: 'DG', outcome: 'PASS', reasons: [], eventId: 'evt-DG-PASS' },
      { check: 'EMBARGO', outcome: 'PASS', reasons: [], eventId: 'evt-EMBARGO-PASS' },
    ]);

    const result = await service.applyScreeningResult(
      checked('SANCTIONS', 'HIT'),
    );

    expect(result).toEqual({
      status: 'decided',
      awb: '020-20000001',
      decision: 'HELD',
    });
    expect(tx.shipment.update).toHaveBeenCalledWith({
      where: { awb: '020-20000001' },
      data: { status: 'HELD' },
    });
    expect(tx.hold.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        awb: '020-20000001',
        shipmentVersion: 1,
        reasons: ['SANCTIONS hit'],
      }),
    });
    expect(tx.outbox.create.mock.calls[0][0].data.type).toBe('shipment.held');
    expect(audit.append).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: 'shipment.held', actor: 'system' }),
    );
  });

  it('ignores stale results for an older shipmentVersion', async () => {
    tx.shipment.findUnique.mockResolvedValue({
      awb: '020-20000001',
      version: 2,
      status: 'CHECKING',
    });
    openPending();

    const result = await service.applyScreeningResult(
      checked('DG', 'HIT', { shipmentVersion: 1 }),
    );

    expect(result).toEqual({ status: 'stale', eventId: 'evt-DG-HIT' });
    expect(tx.pendingCheck.update).not.toHaveBeenCalled();
    expect(tx.shipment.update).not.toHaveBeenCalled();
  });

  it('skips all writes when the event id was already processed', async () => {
    tx.processedEvent.createMany.mockResolvedValue({ count: 0 });

    const result = await service.applyScreeningResult(checked('DG', 'PASS'));

    expect(result).toEqual({ status: 'skipped', eventId: 'evt-DG-PASS' });
    expect(tx.shipment.findUnique).not.toHaveBeenCalled();
    expect(tx.pendingCheck.update).not.toHaveBeenCalled();
    expect(tx.outbox.create).not.toHaveBeenCalled();
  });

  it('holds overdue pending checks with CHECK_TIMEOUT reasons (fail closed)', async () => {
    const overdue = {
      id: 'pend-to',
      awb: '020-20000003',
      shipmentVersion: 1,
      expected: [...EXPECTED_CHECKS],
      received: [{ check: 'DG', outcome: 'PASS', reasons: [], eventId: 'e1' }],
      decidedAt: null,
      correlationId: 'corr-to',
    };
    prisma.pendingCheck.findMany.mockResolvedValue([overdue]);
    tx.pendingCheck.findUnique.mockResolvedValue(overdue);
    tx.shipment.findUnique.mockResolvedValue({
      awb: '020-20000003',
      version: 1,
      status: 'CHECKING',
    });

    const count = await service.sweep(new Date('2026-11-13T10:05:00.000Z'));

    expect(count).toBe(1);
    expect(tx.shipment.update).toHaveBeenCalledWith({
      where: { awb: '020-20000003' },
      data: { status: 'HELD' },
    });
    expect(tx.hold.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reasons: ['CHECK_TIMEOUT:EMBARGO', 'CHECK_TIMEOUT:SANCTIONS'],
      }),
    });
    expect(tx.outbox.create.mock.calls[0][0].data.type).toBe('shipment.held');
    expect(audit.append).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: 'shipment.held', awb: '020-20000003', actor: 'system' }),
    );
  });

  it('carries the Kafka header correlation id onto the decision outbox row and event (T12)', async () => {
    openPending([
      { check: 'DG', outcome: 'PASS', reasons: [], eventId: 'evt-DG-PASS' },
      { check: 'EMBARGO', outcome: 'PASS', reasons: [], eventId: 'evt-EMBARGO-PASS' },
    ]);

    await service.handleMessage(
      JSON.stringify(checked('SANCTIONS', 'PASS', { correlationId: 'corr-envelope' })),
      'corr-header',
    );

    const data = tx.outbox.create.mock.calls[0][0].data;
    expect(data.correlationId).toBe('corr-header');
    expect(data.payload.correlationId).toBe('corr-header');
  });

  it('falls back to the pending check correlation id when header and envelope are empty (T12)', async () => {
    openPending([
      { check: 'DG', outcome: 'PASS', reasons: [], eventId: 'evt-DG-PASS' },
      { check: 'EMBARGO', outcome: 'PASS', reasons: [], eventId: 'evt-EMBARGO-PASS' },
    ]);

    await service.applyScreeningResult(checked('SANCTIONS', 'PASS', { correlationId: '' }));

    expect(tx.outbox.create.mock.calls[0][0].data.correlationId).toBe('corr-1');
  });
});

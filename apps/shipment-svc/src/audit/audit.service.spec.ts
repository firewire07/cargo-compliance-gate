import { PrismaService } from '../prisma/prisma.service';
import { GENESIS_HASH, chainHash, payloadHashOf } from './audit.chain';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  const tx = {
    $executeRaw: jest.fn(),
    auditEntry: { findFirst: jest.fn(), create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(),
    auditEntry: { findMany: jest.fn() },
  };

  let service: AuditService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuditService(prisma as unknown as PrismaService);
    tx.$executeRaw.mockResolvedValue(0);
    tx.auditEntry.create.mockResolvedValue({});
  });

  it('chains each append off the previous hash (or genesis)', async () => {
    tx.auditEntry.findFirst.mockResolvedValue(null);

    await service.append(tx as never, {
      eventId: 'evt-1',
      type: 'shipment.submitted',
      awb: '020-40000001',
      actor: 'system',
      ts: '2026-11-13T10:00:00.000Z',
      payload: { awb: '020-40000001' },
    });

    const firstInput = {
      eventId: 'evt-1',
      type: 'shipment.submitted',
      awb: '020-40000001',
      actor: 'system',
      ts: '2026-11-13T10:00:00.000Z',
      payload: { awb: '020-40000001' },
    };
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.auditEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId: 'evt-1',
        prevHash: GENESIS_HASH,
        payloadHash: payloadHashOf(firstInput),
        hash: chainHash(GENESIS_HASH, firstInput),
      }),
    });

    tx.auditEntry.findFirst.mockResolvedValue({
      hash: chainHash(GENESIS_HASH, firstInput),
    });
    await service.append(tx as never, {
      eventId: 'evt-2',
      type: 'shipment.held',
      awb: '020-40000001',
      actor: 'system',
      ts: '2026-11-13T10:00:01.000Z',
      payload: { status: 'HELD' },
    });
    const secondInput = {
      eventId: 'evt-2',
      type: 'shipment.held',
      awb: '020-40000001',
      actor: 'system',
      ts: '2026-11-13T10:00:01.000Z',
      payload: { status: 'HELD' },
    };
    const firstHash = chainHash(GENESIS_HASH, firstInput);
    expect(tx.auditEntry.create.mock.calls[1][0].data.prevHash).toBe(firstHash);
    expect(tx.auditEntry.create.mock.calls[1][0].data.hash).toBe(
      chainHash(firstHash, secondInput),
    );
  });

  it('detects a tampered stored row on verify', async () => {
    const firstInput = {
      eventId: 'evt-1',
      type: 'shipment.submitted',
      awb: '020-40000001',
      actor: 'system',
      ts: '2026-11-13T10:00:00.000Z',
      payload: { awb: '020-40000001' },
    };
    const firstHash = chainHash(GENESIS_HASH, firstInput);
    prisma.auditEntry.findMany.mockResolvedValue([
      {
        seq: 1,
        ...firstInput,
        ts: new Date(firstInput.ts),
        payloadHash: payloadHashOf(firstInput),
        prevHash: GENESIS_HASH,
        hash: firstHash,
      },
      {
        seq: 2,
        eventId: 'evt-2',
        type: 'shipment.held',
        awb: '020-40000001',
        actor: 'system',
        ts: new Date('2026-11-13T10:00:01.000Z'),
        payload: { status: 'TAMPERED' },
        payloadHash: 'deadbeef',
        prevHash: firstHash,
        hash: 'deadbeef',
      },
    ]);

    await expect(service.verify()).resolves.toEqual({
      ok: false,
      checked: 1,
      firstBrokenSeq: 2,
      reason: 'hash does not recompute from prevHash and canonical payload',
    });
  });
});

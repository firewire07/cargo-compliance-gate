import {
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { Actor } from '../auth/actor';
import { PrismaService } from '../prisma/prisma.service';
import { defaultChecklist } from './hold.checklist';
import { HoldService } from './hold.service';

const analystA: Actor = { actorId: 'analyst-a', role: 'ANALYST', at: '2026-11-13T10:00:00.000Z' };
const analystB: Actor = { actorId: 'analyst-b', role: 'ANALYST', at: '2026-11-13T10:00:01.000Z' };

function completeChecklist() {
  return defaultChecklist().map((item) => ({ ...item, done: true }));
}

describe('HoldService analyst actions', () => {
  const holdRow = {
    id: 'hold-1',
    awb: '020-40000001',
    shipmentVersion: 1,
    reasons: ['SANCTIONS hit'],
    checklist: defaultChecklist(),
    releaseRequestedBy: null,
    releaseRequestedAt: null,
    releaseApprovedBy: null,
    releaseApprovedAt: null,
    releaseRejectedBy: null,
    releaseRejectedAt: null,
    releaseRejectionReason: null,
  };
  const tx = {
    shipment: { findUnique: jest.fn(), update: jest.fn() },
    hold: { findFirst: jest.fn(), update: jest.fn() },
    outbox: { create: jest.fn() },
  };
  const prisma = { $transaction: jest.fn() };
  const audit = { append: jest.fn() };
  let service: HoldService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) =>
      fn(tx),
    );
    audit.append.mockResolvedValue(undefined);
    tx.shipment.findUnique.mockResolvedValue({
      awb: '020-40000001',
      version: 1,
      status: 'HELD',
    });
    tx.hold.findFirst.mockResolvedValue({ ...holdRow });
    tx.hold.update.mockImplementation(async ({ data }: { data: object }) => ({
      ...holdRow,
      ...data,
    }));
    tx.shipment.update.mockResolvedValue({ awb: '020-40000001', status: 'RELEASED' });
    tx.outbox.create.mockResolvedValue({});
    service = new HoldService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  it('rejects an approval from the same analyst who requested release', async () => {
    tx.hold.findFirst.mockResolvedValue({
      ...holdRow,
      checklist: completeChecklist(),
      releaseRequestedBy: 'analyst-a',
      releaseRequestedAt: new Date(),
    });

    await expect(service.approveRelease('020-40000001', analystA)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.shipment.update).not.toHaveBeenCalled();
    expect(tx.outbox.create).not.toHaveBeenCalled();
  });

  it('lets a second analyst approve and marks the shipment RELEASED', async () => {
    tx.hold.findFirst.mockResolvedValue({
      ...holdRow,
      checklist: completeChecklist(),
      releaseRequestedBy: 'analyst-a',
      releaseRequestedAt: new Date(),
    });

    const result = await service.approveRelease('020-40000001', analystB, 'corr-rel');

    expect(tx.shipment.update).toHaveBeenCalledWith({
      where: { awb: '020-40000001' },
      data: { status: 'RELEASED' },
    });
    const types = tx.outbox.create.mock.calls.map((call) => call[0].data.type);
    expect(types).toEqual(['hold.release.approved', 'shipment.released']);
    expect(tx.outbox.create.mock.calls[0][0].data.payload.actor).toEqual(
      expect.objectContaining({ actorId: 'analyst-b', role: 'ANALYST' }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        type: 'hold.release.approved',
        actor: 'analyst-b',
        awb: '020-40000001',
      }),
    );
    expect(result.shipment.status).toBe('RELEASED');
  });

  it('refuses a release request until the checklist is complete', async () => {
    await expect(service.requestRelease('020-40000001', analystA)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

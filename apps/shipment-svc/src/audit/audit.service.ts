import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import {
  CanonicalAuditInput,
  ChainVerifyResult,
  GENESIS_HASH,
  StoredAuditRow,
  chainHash,
  payloadHashOf,
  verifyChain,
} from './audit.chain';

/** Stable advisory-lock key so appends are serialised across transactions. */
const AUDIT_CHAIN_LOCK = 746_584_01;

export type AppendAuditInput = {
  eventId: string;
  type: string;
  awb: string;
  actor: string;
  ts: Date | string;
  payload: unknown;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async append(
    tx: Prisma.TransactionClient,
    input: AppendAuditInput,
  ): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK})`;
    const last = await tx.auditEntry.findFirst({
      orderBy: { seq: 'desc' },
    });
    const ts =
      typeof input.ts === 'string' ? input.ts : input.ts.toISOString();
    const canonical: CanonicalAuditInput = {
      eventId: input.eventId,
      type: input.type,
      awb: input.awb,
      actor: input.actor,
      ts,
      payload: input.payload,
    };
    const prevHash = last?.hash ?? GENESIS_HASH;
    const payloadHash = payloadHashOf(canonical);
    const hash = chainHash(prevHash, canonical);
    await tx.auditEntry.create({
      data: {
        eventId: canonical.eventId,
        type: canonical.type,
        awb: canonical.awb,
        actor: canonical.actor,
        ts: new Date(ts),
        payload: canonical.payload as Prisma.InputJsonValue,
        payloadHash,
        prevHash,
        hash,
      },
    });
  }

  listByAwb(awb: string) {
    return this.prisma.auditEntry.findMany({
      where: { awb },
      orderBy: { seq: 'asc' },
    });
  }

  async verify(): Promise<ChainVerifyResult> {
    const rows = await this.prisma.auditEntry.findMany({
      orderBy: { seq: 'asc' },
    });
    const stored: StoredAuditRow[] = rows.map((row) => ({
      seq: row.seq,
      eventId: row.eventId,
      type: row.type,
      awb: row.awb,
      actor: row.actor,
      ts: row.ts.toISOString(),
      payload: row.payload,
      payloadHash: row.payloadHash,
      prevHash: row.prevHash,
      hash: row.hash,
    }));
    return verifyChain(stored);
  }
}

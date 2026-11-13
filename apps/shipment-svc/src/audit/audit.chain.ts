import { createHash } from 'crypto';

export const GENESIS_HASH = '0'.repeat(64);

export type CanonicalAuditInput = {
  eventId: string;
  type: string;
  awb: string;
  actor: string;
  ts: string;
  payload: unknown;
};

export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function payloadHashOf(input: CanonicalAuditInput): string {
  return sha256(canonicalize(input));
}

/** hash = sha256(prevHash + canonical payload), as specified for T6. */
export function chainHash(prevHash: string, input: CanonicalAuditInput): string {
  return sha256(prevHash + canonicalize(input));
}

export type StoredAuditRow = CanonicalAuditInput & {
  seq: number;
  payloadHash: string;
  prevHash: string;
  hash: string;
};

export type ChainVerifyResult =
  | { ok: true; checked: number }
  | { ok: false; checked: number; firstBrokenSeq: number; reason: string };

export function verifyChain(rows: StoredAuditRow[]): ChainVerifyResult {
  let prevHash = GENESIS_HASH;
  let expectedSeq = 1;
  for (const row of rows) {
    if (row.seq !== expectedSeq) {
      return {
        ok: false,
        checked: expectedSeq - 1,
        firstBrokenSeq: row.seq,
        reason: `sequence gap: expected ${expectedSeq}, got ${row.seq}`,
      };
    }
    const input: CanonicalAuditInput = {
      eventId: row.eventId,
      type: row.type,
      awb: row.awb,
      actor: row.actor,
      ts: row.ts,
      payload: row.payload,
    };
    const expectedPayloadHash = payloadHashOf(input);
    const expectedHash = chainHash(prevHash, input);
    if (row.prevHash !== prevHash) {
      return {
        ok: false,
        checked: expectedSeq - 1,
        firstBrokenSeq: row.seq,
        reason: 'prevHash does not match the previous entry hash',
      };
    }
    if (row.payloadHash !== expectedPayloadHash || row.hash !== expectedHash) {
      return {
        ok: false,
        checked: expectedSeq - 1,
        firstBrokenSeq: row.seq,
        reason: 'hash does not recompute from prevHash and canonical payload',
      };
    }
    prevHash = row.hash;
    expectedSeq += 1;
  }
  return { ok: true, checked: rows.length };
}

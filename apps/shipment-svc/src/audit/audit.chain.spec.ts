import {
  GENESIS_HASH,
  canonicalize,
  chainHash,
  payloadHashOf,
  verifyChain,
  type StoredAuditRow,
} from './audit.chain';

function entry(
  seq: number,
  prevHash: string,
  overrides: Partial<StoredAuditRow> = {},
): StoredAuditRow {
  const input = {
    eventId: `evt-${seq}`,
    type: 'shipment.submitted',
    awb: '020-40000001',
    actor: 'system',
    ts: `2026-11-13T10:00:0${seq}.000Z`,
    payload: { awb: '020-40000001', step: seq },
  };
  const row: StoredAuditRow = {
    seq,
    ...input,
    payloadHash: payloadHashOf(input),
    prevHash,
    hash: chainHash(prevHash, input),
    ...overrides,
  };
  return row;
}

describe('audit chain', () => {
  it('canonicalizes objects with sorted keys so hashes are stable', () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
  });

  it('builds a verifiable hash chain from genesis', () => {
    const first = entry(1, GENESIS_HASH);
    const second = entry(2, first.hash);
    expect(verifyChain([first, second])).toEqual({ ok: true, checked: 2 });
  });

  it('reports the first tampered sequence', () => {
    const first = entry(1, GENESIS_HASH);
    const second = entry(2, first.hash);
    const tampered: StoredAuditRow = {
      ...second,
      payload: { awb: '020-40000001', step: 99 },
    };
    expect(verifyChain([first, tampered])).toEqual({
      ok: false,
      checked: 1,
      firstBrokenSeq: 2,
      reason: 'hash does not recompute from prevHash and canonical payload',
    });
  });
});

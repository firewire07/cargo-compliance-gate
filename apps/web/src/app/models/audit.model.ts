export interface AuditEntry {
  seq: number;
  eventId: string;
  type: string;
  awb: string;
  actor: string;
  ts: string;
  payload?: unknown;
  payloadHash: string;
  prevHash: string;
  hash: string;
}

export type AuditVerifyResult =
  | { ok: true; checked: number }
  | { ok: false; checked: number; firstBrokenSeq: number; reason: string };

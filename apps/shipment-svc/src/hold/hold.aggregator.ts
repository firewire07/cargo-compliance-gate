export const EXPECTED_CHECKS = ['DG', 'EMBARGO', 'SANCTIONS'] as const;
export type CheckName = (typeof EXPECTED_CHECKS)[number];
export type CheckOutcome = 'PASS' | 'HIT';

export type ReceivedCheck = {
  check: string;
  outcome: CheckOutcome;
  reasons: string[];
  ruleVersion?: string;
  score?: number;
  eventId: string;
};

export type Decision = {
  status: 'HELD' | 'CLEARED';
  reasons: string[];
};

export function isStale(
  eventVersion: number,
  currentVersion: number,
): boolean {
  return eventVersion < currentVersion;
}

export function alreadyReceived(
  received: ReceivedCheck[],
  check: string,
): boolean {
  return received.some((item) => item.check === check);
}

export function missingChecks(
  expected: readonly string[],
  received: ReceivedCheck[],
): string[] {
  const got = new Set(received.map((item) => item.check));
  return expected.filter((check) => !got.has(check));
}

export function allExpectedReceived(
  expected: readonly string[],
  received: ReceivedCheck[],
): boolean {
  return missingChecks(expected, received).length === 0;
}

export function decide(received: ReceivedCheck[]): Decision {
  const hits = received.filter((item) => item.outcome === 'HIT');
  if (hits.length === 0) {
    return { status: 'CLEARED', reasons: [] };
  }
  return {
    status: 'HELD',
    reasons: hits.flatMap((item) =>
      item.reasons.length > 0 ? item.reasons : [`${item.check}:HIT`],
    ),
  };
}

export function timeoutReasons(
  expected: readonly string[],
  received: ReceivedCheck[],
): string[] {
  return missingChecks(expected, received).map(
    (name) => `CHECK_TIMEOUT:${name}`,
  );
}

export function holdTimeoutSeconds(): number {
  const raw = Number(process.env.HOLD_TIMEOUT_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

export function holdSweepIntervalMs(): number {
  const raw = Number(process.env.HOLD_SWEEP_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 2000;
}

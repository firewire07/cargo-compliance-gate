import {
  EXPECTED_CHECKS,
  allExpectedReceived,
  alreadyReceived,
  decide,
  isStale,
  missingChecks,
  timeoutReasons,
  ReceivedCheck,
} from './hold.aggregator';

const pass = (check: string, eventId = `${check}-1`): ReceivedCheck => ({
  check,
  outcome: 'PASS',
  reasons: [],
  eventId,
});

const hit = (check: string, reasons: string[]): ReceivedCheck => ({
  check,
  outcome: 'HIT',
  reasons,
  eventId: `${check}-hit`,
});

describe('hold aggregator', () => {
  it('clears when every expected check has passed', () => {
    const received = EXPECTED_CHECKS.map((check) => pass(check));
    expect(allExpectedReceived(EXPECTED_CHECKS, received)).toBe(true);
    expect(decide(received)).toEqual({ status: 'CLEARED', reasons: [] });
  });

  it('holds when any check is a HIT and keeps the check reasons', () => {
    const received = [
      pass('DG'),
      pass('EMBARGO'),
      hit('SANCTIONS', ['consignee matched Viktor Petrov Trading']),
    ];
    expect(allExpectedReceived(EXPECTED_CHECKS, received)).toBe(true);
    expect(decide(received)).toEqual({
      status: 'HELD',
      reasons: ['consignee matched Viktor Petrov Trading'],
    });
  });

  it('treats a lower shipmentVersion as stale', () => {
    expect(isStale(1, 2)).toBe(true);
    expect(isStale(2, 2)).toBe(false);
    expect(isStale(3, 2)).toBe(false);
  });

  it('does not count a check twice when the same result is replayed', () => {
    const received = [pass('DG')];
    expect(alreadyReceived(received, 'DG')).toBe(true);
    expect(alreadyReceived(received, 'SANCTIONS')).toBe(false);
    expect(missingChecks(EXPECTED_CHECKS, received)).toEqual([
      'EMBARGO',
      'SANCTIONS',
    ]);
  });

  it('builds a CHECK_TIMEOUT reason for each missing check', () => {
    expect(timeoutReasons(EXPECTED_CHECKS, [pass('DG')])).toEqual([
      'CHECK_TIMEOUT:EMBARGO',
      'CHECK_TIMEOUT:SANCTIONS',
    ]);
  });
});

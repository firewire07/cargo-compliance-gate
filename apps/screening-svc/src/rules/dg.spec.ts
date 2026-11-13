import { checkDg, normalizeUnNumber } from './dg';

describe('checkDg', () => {
  it('passes when no UN number is declared', () => {
    const result = checkDg({});
    expect(result.outcome).toBe('PASS');
    expect(result.ruleVersion).toBe('dg.v1');
    expect(result.reasons).toEqual([]);
  });

  it('hits when a listed UN number is forbidden on passenger aircraft', () => {
    expect(checkDg({ unNumber: 'UN0220' }).outcome).toBe('HIT');
    expect(checkDg({ unNumber: '220' }).outcome).toBe('HIT');
    expect(checkDg({ unNumber: 'un0220' }).reasons[0]).toMatch(/UN0220/);
  });

  it('passes an unlisted UN number', () => {
    expect(checkDg({ unNumber: 'UN1845' }).outcome).toBe('PASS');
  });

  it('allows a passenger-only forbidden UN number on cargo aircraft', () => {
    expect(
      checkDg({ unNumber: 'UN0220', aircraftType: 'CARGO' }).outcome,
    ).toBe('PASS');
  });

  it('normalises UN numbers', () => {
    expect(normalizeUnNumber('220')).toBe('UN0220');
    expect(normalizeUnNumber('UN-0150')).toBe('UN0150');
  });
});

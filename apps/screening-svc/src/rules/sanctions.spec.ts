import {
  nameScore,
  normalizeName,
  screenSanctions,
  screenSanctionsNameOnly,
} from './sanctions';

describe('screenSanctions name-only', () => {
  it('passes ordinary commercial names', () => {
    const result = screenSanctionsNameOnly({
      shipper: { name: 'Acme Forwarding', country: 'MY' },
      consignee: { name: 'Rotterdam Imports', country: 'NL' },
    });
    expect(result.outcome).toBe('PASS');
    expect(result.ruleVersion).toBe('sanctions-name-only.v1');
    expect(result.score ?? 0).toBeLessThan(0.85);
  });

  it('hits an exact sanctioned consignee', () => {
    const result = screenSanctionsNameOnly({
      shipper: { name: 'Acme Forwarding', country: 'MY' },
      consignee: { name: 'Viktor Petrov Trading', country: 'RU' },
    });
    expect(result.outcome).toBe('HIT');
    expect(result.score).toBe(1);
    expect(result.reasons[0]).toMatch(/Viktor Petrov Trading/);
  });

  it('hits a close fuzzy variant of a listed name', () => {
    const result = screenSanctionsNameOnly({
      consignee: { name: 'Viktor Petrov Trading Co', country: 'RU' },
    });
    expect(result.outcome).toBe('HIT');
    expect(result.score ?? 0).toBeGreaterThanOrEqual(0.85);
  });

  it('exposes a contextual seam that still delegates in T3', () => {
    const nameOnly = screenSanctions(
      { consignee: { name: 'Viktor Petrov Trading' } },
      'name-only',
    );
    const contextual = screenSanctions(
      { consignee: { name: 'Viktor Petrov Trading' } },
      'contextual',
    );
    expect(nameOnly.outcome).toBe('HIT');
    expect(contextual.outcome).toBe('HIT');
    expect(contextual.inputs['mode']).toBe('contextual');
  });

  it('scores typoed names highly after normalisation', () => {
    expect(normalizeName('Viktor Petrov Trading Co.')).toContain('viktor');
    expect(nameScore('Viktor Petrov Tradng', 'Viktor Petrov Trading')).toBeGreaterThan(
      0.85,
    );
  });
});

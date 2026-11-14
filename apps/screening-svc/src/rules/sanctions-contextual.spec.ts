import {
  parseSanctionsMode,
  screenSanctions,
  screenSanctionsContextual,
  screenSanctionsNameOnly,
} from './sanctions';

const listed = {
  consignee: {
    name: 'Viktor Petrov Trading',
    country: 'RU',
    address: '14 Nevsky Lane, Office 9, Saint Petersburg',
    registrationDate: '2009-04-17',
  },
  origin: 'KUL',
  destination: 'SVO',
  routing: 'KUL-SVO',
  goodsDescription: 'Industrial parts',
  hsCode: '8481.80',
};

describe('parseSanctionsMode', () => {
  it('defaults to name-only unless contextual is requested', () => {
    expect(parseSanctionsMode(undefined)).toBe('name-only');
    expect(parseSanctionsMode('')).toBe('name-only');
    expect(parseSanctionsMode('NAME-ONLY')).toBe('name-only');
    expect(parseSanctionsMode('contextual')).toBe('contextual');
    expect(parseSanctionsMode(' Contextual ')).toBe('contextual');
  });
});

describe('screenSanctionsContextual', () => {
  it('hits a listed party when country and registration agree', () => {
    const result = screenSanctionsContextual(listed);
    expect(result.outcome).toBe('HIT');
    expect(result.ruleVersion).toBe('sanctions-contextual.v1');
    expect(result.score ?? 0).toBeGreaterThanOrEqual(0.85);
    expect(result.reasons.join(' ')).toMatch(/supporting country/);
    expect(result.reasons.join(' ')).toMatch(/supporting date/);
  });

  it('still hits an exact listed name when context is missing', () => {
    const result = screenSanctionsContextual({
      consignee: { name: 'Viktor Petrov Trading' },
      origin: 'KUL',
      destination: 'AMS',
    });
    expect(result.outcome).toBe('HIT');
    expect(result.score ?? 0).toBeGreaterThanOrEqual(0.85);
  });

  it('still hits a near-exact name that only disagrees on country', () => {
    const result = screenSanctionsContextual({
      consignee: { name: 'Viktor Petrov Trading', country: 'NL' },
      origin: 'KUL',
      destination: 'AMS',
      routing: 'KUL-AMS',
    });
    expect(result.outcome).toBe('HIT');
    expect(result.reasons.join(' ')).toMatch(/conflicting country/);
  });

  it('hits a typoed name when the country supports the match', () => {
    const result = screenSanctionsContextual({
      consignee: { name: 'Viktor Petrov Tradng', country: 'RU' },
      origin: 'KUL',
      destination: 'SVO',
    });
    expect(result.outcome).toBe('HIT');
    expect(screenSanctionsNameOnly({ consignee: { name: 'Viktor Petrov Tradng' } }).outcome).toBe(
      'HIT',
    );
  });

  it('clears a look-alike that name-only would hold, when country and registration conflict', () => {
    const lookAlike = {
      consignee: {
        name: 'Viktor Petrov Trading BV',
        country: 'NL',
        address: '12 Keizersgracht, Amsterdam',
        registrationDate: '2018-02-02',
      },
      origin: 'KUL',
      destination: 'AMS',
      routing: 'KUL-AMS',
      goodsDescription: 'Office furniture',
      hsCode: '9403.10',
    };
    expect(screenSanctionsNameOnly(lookAlike).outcome).toBe('HIT');
    const contextual = screenSanctionsContextual(lookAlike);
    expect(contextual.outcome).toBe('PASS');
    expect(contextual.score ?? 1).toBeLessThan(0.85);
  });

  it('treats a supporting route as a positive signal', () => {
    const result = screenSanctionsContextual({
      consignee: { name: 'Golden River Shipping' },
      origin: 'KUL',
      destination: 'IKA',
      routing: 'KUL-DXB-IKA',
    });
    expect(result.outcome).toBe('HIT');
    expect(result.reasons.join(' ')).toMatch(/supporting route/);
  });

  it('records a supporting commodity when the HS code matches a listed prefix', () => {
    const result = screenSanctionsContextual({
      consignee: { name: 'Viktor Petrov Trading', country: 'RU' },
      origin: 'KUL',
      destination: 'SVO',
      goodsDescription: 'Spare munitions cases',
      hsCode: '9302.00',
    });
    expect(result.outcome).toBe('HIT');
    expect(result.reasons.join(' ')).toMatch(/supporting commodity/);
  });

  it('passes an ordinary commercial name', () => {
    const result = screenSanctionsContextual({
      shipper: { name: 'Acme Forwarding', country: 'MY' },
      consignee: { name: 'Rotterdam Imports', country: 'NL', address: '1 Waalhaven, Rotterdam' },
      origin: 'KUL',
      destination: 'AMS',
      goodsDescription: 'Electronic parts',
      hsCode: '8542.31',
    });
    expect(result.outcome).toBe('PASS');
    expect(result.score ?? 0).toBeLessThan(0.85);
  });

  it('is selected only when mode is contextual', () => {
    expect(screenSanctions(listed).inputs['mode']).toBe('name-only');
    expect(screenSanctions(listed, 'contextual').inputs['mode']).toBe('contextual');
  });
});

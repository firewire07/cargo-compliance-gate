import { checkEmbargo, resolveCountry, loadEmbargoCatalog } from './embargo';

describe('checkEmbargo', () => {
  const catalog = loadEmbargoCatalog();

  it('passes a clean KUL-AMS routing', () => {
    const result = checkEmbargo({
      origin: 'KUL',
      destination: 'AMS',
      routing: 'KUL-AMS',
    });
    expect(result.outcome).toBe('PASS');
    expect(result.ruleVersion).toBe('embargo.v1');
  });

  it('hits when the destination airport maps to an embargoed country', () => {
    const result = checkEmbargo({
      origin: 'KUL',
      destination: 'FNJ',
      routing: 'KUL-FNJ',
    });
    expect(result.outcome).toBe('HIT');
    expect(result.reasons.join(' ')).toMatch(/KP/);
  });

  it('hits when a routing token is an embargoed country code', () => {
    const result = checkEmbargo({
      origin: 'AMS',
      destination: 'KUL',
      routing: 'AMS-SY-KUL',
    });
    expect(result.outcome).toBe('HIT');
    expect(result.reasons.join(' ')).toMatch(/SY/);
  });

  it('resolves IATA codes via the catalog map', () => {
    expect(resolveCountry('KUL', catalog)).toBe('MY');
    expect(resolveCountry('KP', catalog)).toBe('KP');
  });
});

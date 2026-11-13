import { loadCatalog } from './load-catalog';
import { RuleResult } from './types';

export type EmbargoCatalog = {
  ruleVersion: string;
  countries: string[];
  airports: Record<string, string>;
};

export type EmbargoInput = {
  origin?: string | null;
  destination?: string | null;
  routing?: string | null;
};

let cached: EmbargoCatalog | undefined;

export function loadEmbargoCatalog(): EmbargoCatalog {
  if (!cached) {
    cached = loadCatalog<EmbargoCatalog>('embargo-list.v1.json');
  }
  return cached;
}

function tokensOf(value?: string | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

export function resolveCountry(
  token: string,
  catalog: EmbargoCatalog,
): string | undefined {
  const upper = token.toUpperCase();
  if (upper.length === 2) {
    return upper;
  }
  return catalog.airports[upper];
}

export function checkEmbargo(
  input: EmbargoInput,
  catalog = loadEmbargoCatalog(),
): RuleResult {
  const embargoed = new Set(catalog.countries.map((item) => item.toUpperCase()));
  const fields: { field: string; token: string }[] = [];
  for (const token of tokensOf(input.origin)) {
    fields.push({ field: 'origin', token });
  }
  for (const token of tokensOf(input.destination)) {
    fields.push({ field: 'destination', token });
  }
  for (const token of tokensOf(input.routing)) {
    fields.push({ field: 'routing', token });
  }

  const reasons: string[] = [];
  const resolved: { field: string; token: string; country?: string }[] = [];
  for (const item of fields) {
    const country = resolveCountry(item.token, catalog);
    resolved.push({ ...item, country });
    if (country && embargoed.has(country)) {
      reasons.push(
        `${item.field} ${item.token} resolves to embargoed country ${country} (${catalog.ruleVersion})`,
      );
    }
  }

  return {
    check: 'EMBARGO',
    outcome: reasons.length > 0 ? 'HIT' : 'PASS',
    ruleVersion: catalog.ruleVersion,
    reasons,
    inputs: {
      origin: input.origin ?? null,
      destination: input.destination ?? null,
      routing: input.routing ?? null,
      resolved,
    },
  };
}

import { loadCatalog } from './load-catalog';
import { RuleResult } from './types';

export type SanctionsEntry = { name: string; country?: string };

export type SanctionsCatalog = {
  ruleVersion: string;
  threshold: number;
  entries: SanctionsEntry[];
};

export type SanctionsInput = {
  shipper?: { name?: string; country?: string } | null;
  consignee?: { name?: string; country?: string } | null;
  origin?: string | null;
  destination?: string | null;
  routing?: string | null;
  goodsDescription?: string | null;
  hsCode?: string | null;
};

export type SanctionsMode = 'name-only' | 'contextual';

let cached: SanctionsCatalog | undefined;

export function loadSanctionsCatalog(): SanctionsCatalog {
  if (!cached) {
    cached = loadCatalog<SanctionsCatalog>('sanctions-list.v1.json');
  }
  return cached;
}

const NOISE = new Set([
  'ltd',
  'llc',
  'inc',
  'co',
  'company',
  'corp',
  'limited',
  'plc',
  'gmbh',
  'sa',
  'ag',
  'bv',
  'trading',
  'holdings',
  'services',
  'agency',
  'house',
  'export',
  'import',
  'logistics',
  'shipping',
  'cargo',
  'freight',
]);

export function normalizeName(value?: string | null): string {
  if (!value) {
    return '';
  }
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (!a.length) {
    return b.length;
  }
  if (!b.length) {
    return a.length;
  }
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(0),
  );
  for (let i = 0; i < rows; i++) {
    matrix[i][0] = i;
  }
  for (let j = 0; j < cols; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}

export function similarity(a: string, b: string): number {
  if (!a && !b) {
    return 1;
  }
  const maxLen = Math.max(a.length, b.length);
  if (!maxLen) {
    return 1;
  }
  return 1 - levenshtein(a, b) / maxLen;
}

function tokens(value: string): string[] {
  return normalizeName(value).split(' ').filter(Boolean);
}

export function nameScore(candidate: string, entryName: string): number {
  const a = normalizeName(candidate);
  const b = normalizeName(entryName);
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  const full = similarity(a, b);
  const aTokens = tokens(a).filter((token) => !NOISE.has(token));
  const bTokens = tokens(b).filter((token) => !NOISE.has(token));
  if (!aTokens.length || !bTokens.length) {
    return full;
  }
  const tokenScores = aTokens.map((token) =>
    Math.max(...bTokens.map((other) => similarity(token, other))),
  );
  const tokenAvg =
    tokenScores.reduce((sum, score) => sum + score, 0) / tokenScores.length;
  return Math.max(full, tokenAvg);
}

export type NameMatch = {
  party: 'shipper' | 'consignee';
  partyName: string;
  matchedName: string;
  score: number;
};

export function bestNameMatch(
  input: SanctionsInput,
  catalog: SanctionsCatalog,
): NameMatch | undefined {
  const parties: { party: 'shipper' | 'consignee'; name: string }[] = [];
  if (input.shipper?.name) {
    parties.push({ party: 'shipper', name: input.shipper.name });
  }
  if (input.consignee?.name) {
    parties.push({ party: 'consignee', name: input.consignee.name });
  }
  let best: NameMatch | undefined;
  for (const party of parties) {
    for (const entry of catalog.entries) {
      const score = nameScore(party.name, entry.name);
      if (!best || score > best.score) {
        best = {
          party: party.party,
          partyName: party.name,
          matchedName: entry.name,
          score,
        };
      }
    }
  }
  return best;
}

export function screenSanctionsNameOnly(
  input: SanctionsInput,
  catalog = loadSanctionsCatalog(),
): RuleResult {
  const match = bestNameMatch(input, catalog);
  const score = match?.score ?? 0;
  const hit = !!match && score >= catalog.threshold;
  return {
    check: 'SANCTIONS',
    outcome: hit ? 'HIT' : 'PASS',
    ruleVersion: catalog.ruleVersion,
    score,
    reasons:
      hit && match
        ? [
            `${match.party} "${match.partyName}" matched sanctioned name "${match.matchedName}" (score ${score.toFixed(2)}, threshold ${catalog.threshold})`,
          ]
        : [],
    inputs: {
      shipper: input.shipper ?? null,
      consignee: input.consignee ?? null,
      mode: 'name-only',
      match: match ?? null,
      threshold: catalog.threshold,
    },
  };
}

// Seam for T8: contextual scoring will combine name score with routing, goods, HS code and country.
export function screenSanctionsContextual(
  input: SanctionsInput,
  catalog = loadSanctionsCatalog(),
): RuleResult {
  const result = screenSanctionsNameOnly(input, catalog);
  return {
    ...result,
    inputs: { ...result.inputs, mode: 'contextual', contextual: 'not-implemented' },
  };
}

export function screenSanctions(
  input: SanctionsInput,
  mode: SanctionsMode = 'name-only',
  catalog = loadSanctionsCatalog(),
): RuleResult {
  return mode === 'contextual'
    ? screenSanctionsContextual(input, catalog)
    : screenSanctionsNameOnly(input, catalog);
}

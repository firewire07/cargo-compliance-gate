import { loadCatalog } from './load-catalog';
import { RuleResult } from './types';

export type PartyInput = {
  name?: string;
  country?: string;
  address?: string;
  dateOfBirth?: string;
  registrationDate?: string;
};

export type SanctionsEntry = {
  name: string;
  country?: string;
  address?: string;
  dateOfBirth?: string;
  registrationDate?: string;
  riskHsPrefixes?: string[];
  riskGoodsKeywords?: string[];
};

export type SanctionsCatalog = {
  ruleVersion: string;
  contextualRuleVersion?: string;
  threshold: number;
  entries: SanctionsEntry[];
};

export type SanctionsInput = {
  shipper?: PartyInput | null;
  consignee?: PartyInput | null;
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

export function parseSanctionsMode(value?: string | null): SanctionsMode {
  return value?.trim().toLowerCase() === 'contextual' ? 'contextual' : 'name-only';
}

/** Airports used in the local demo and evaluation routes, mapped to ISO countries. */
const AIRPORT_COUNTRY: Record<string, string> = {
  AMS: 'NL',
  BKK: 'TH',
  CDG: 'FR',
  DAM: 'SY',
  DOH: 'QA',
  DXB: 'AE',
  FNJ: 'KP',
  FRA: 'DE',
  HKG: 'HK',
  IKA: 'IR',
  IST: 'TR',
  JFK: 'US',
  KUL: 'MY',
  LED: 'RU',
  LHR: 'GB',
  ORD: 'US',
  PVG: 'CN',
  SHJ: 'AE',
  SIN: 'SG',
  SVO: 'RU',
  SYX: 'CN',
};

const COUNTRY_WEIGHT = 0.12;
const ADDRESS_WEIGHT = 0.1;
const DATE_WEIGHT = 0.12;
const ROUTE_WEIGHT = 0.08;
const GOODS_WEIGHT = 0.05;
const ADDRESS_MATCH_MIN = 0.85;
const ADDRESS_CONFLICT_MAX = 0.55;
/** Above this, a name is treated as near-exact; address format differences are ignored. */
const NEAR_EXACT_NAME = 0.97;

export type ContextSignal = 'match' | 'conflict' | 'unknown';

export type ContextBreakdown = {
  country: ContextSignal;
  address: ContextSignal;
  date: ContextSignal;
  route: ContextSignal;
  goods: ContextSignal;
  adjustment: number;
  confirms: number;
  conflicts: number;
};

function normalizeCountry(value?: string | null): string {
  return value?.trim().toUpperCase() ?? '';
}

function normalizeText(value?: string | null): string {
  return normalizeName(value);
}

function normalizeDate(value?: string | null): string {
  if (!value) {
    return '';
  }
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/);
  return match ? trimmed.slice(0, 10) : '';
}

function countrySignal(partyCountry?: string, entryCountry?: string): ContextSignal {
  const left = normalizeCountry(partyCountry);
  const right = normalizeCountry(entryCountry);
  if (!left || !right) {
    return 'unknown';
  }
  return left === right ? 'match' : 'conflict';
}

function addressSignal(partyAddress?: string, entryAddress?: string): ContextSignal {
  const left = normalizeText(partyAddress);
  const right = normalizeText(entryAddress);
  if (!left || !right) {
    return 'unknown';
  }
  const score = similarity(left, right);
  if (score >= ADDRESS_MATCH_MIN) {
    return 'match';
  }
  if (score <= ADDRESS_CONFLICT_MAX) {
    return 'conflict';
  }
  return 'unknown';
}

function dateSignal(party: PartyInput | undefined, entry: SanctionsEntry): ContextSignal {
  const partyDate = normalizeDate(party?.registrationDate) || normalizeDate(party?.dateOfBirth);
  const entryDate =
    normalizeDate(entry.registrationDate) || normalizeDate(entry.dateOfBirth);
  if (!partyDate || !entryDate) {
    return 'unknown';
  }
  return partyDate === entryDate ? 'match' : 'conflict';
}

export function countriesFromRoute(
  origin?: string | null,
  destination?: string | null,
  routing?: string | null,
): Set<string> {
  const tokens = [origin, destination, ...(routing ?? '').split(/[^A-Za-z0-9]+/)]
    .map((token) => token?.trim().toUpperCase())
    .filter((token): token is string => !!token);
  const countries = new Set<string>();
  for (const token of tokens) {
    if (token.length === 2) {
      countries.add(token);
    } else if (token.length === 3 && AIRPORT_COUNTRY[token]) {
      countries.add(AIRPORT_COUNTRY[token]);
    }
  }
  return countries;
}

function routeSignal(input: SanctionsInput, entryCountry?: string): ContextSignal {
  const country = normalizeCountry(entryCountry);
  if (!country) {
    return 'unknown';
  }
  return countriesFromRoute(input.origin, input.destination, input.routing).has(country)
    ? 'match'
    : 'unknown';
}

function goodsSignal(input: SanctionsInput, entry: SanctionsEntry): ContextSignal {
  const hs = (input.hsCode ?? '').replace(/[^0-9]/g, '');
  if (hs && entry.riskHsPrefixes?.some((prefix) => hs.startsWith(prefix.replace(/[^0-9]/g, '')))) {
    return 'match';
  }
  const goods = normalizeText(input.goodsDescription);
  if (
    goods &&
    entry.riskGoodsKeywords?.some((keyword) => goods.includes(normalizeText(keyword)))
  ) {
    return 'match';
  }
  return 'unknown';
}

function countSignals(
  breakdown: Pick<ContextBreakdown, 'country' | 'address' | 'date' | 'route' | 'goods'>,
  value: ContextSignal,
): number {
  return [breakdown.country, breakdown.address, breakdown.date, breakdown.route, breakdown.goods].filter(
    (signal) => signal === value,
  ).length;
}

export function scoreContext(
  party: PartyInput,
  input: SanctionsInput,
  entry: SanctionsEntry,
  nameScoreValue: number,
): ContextBreakdown {
  const country = countrySignal(party.country, entry.country);
  // Near-exact names skip address conflicts: street format is easy to spoof or vary.
  const rawAddress = addressSignal(party.address, entry.address);
  const address =
    nameScoreValue >= NEAR_EXACT_NAME && rawAddress === 'conflict' ? 'unknown' : rawAddress;
  const date = dateSignal(party, entry);
  const route = routeSignal(input, entry.country);
  const goods = goodsSignal(input, entry);
  let adjustment = 0;
  if (country === 'match') adjustment += COUNTRY_WEIGHT;
  if (country === 'conflict') adjustment -= COUNTRY_WEIGHT;
  if (address === 'match') adjustment += ADDRESS_WEIGHT;
  if (address === 'conflict') adjustment -= ADDRESS_WEIGHT;
  if (date === 'match') adjustment += DATE_WEIGHT;
  if (date === 'conflict') adjustment -= DATE_WEIGHT;
  if (route === 'match') adjustment += ROUTE_WEIGHT;
  if (goods === 'match') adjustment += GOODS_WEIGHT;
  const breakdown = { country, address, date, route, goods, adjustment, confirms: 0, conflicts: 0 };
  breakdown.confirms = countSignals(breakdown, 'match');
  breakdown.conflicts = countSignals(breakdown, 'conflict');
  return breakdown;
}

function clampScore(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export type ContextualMatch = NameMatch & {
  entry: SanctionsEntry;
  nameScore: number;
  finalScore: number;
  context: ContextBreakdown;
};

export function bestContextualMatch(
  input: SanctionsInput,
  catalog: SanctionsCatalog,
): ContextualMatch | undefined {
  const parties: { party: 'shipper' | 'consignee'; data: PartyInput }[] = [];
  if (input.shipper?.name) {
    parties.push({ party: 'shipper', data: input.shipper });
  }
  if (input.consignee?.name) {
    parties.push({ party: 'consignee', data: input.consignee });
  }
  let best: ContextualMatch | undefined;
  for (const party of parties) {
    for (const entry of catalog.entries) {
      const name = nameScore(party.data.name ?? '', entry.name);
      const context = scoreContext(party.data, input, entry, name);
      const finalScore = clampScore(name + context.adjustment);
      const candidate: ContextualMatch = {
        party: party.party,
        partyName: party.data.name ?? '',
        matchedName: entry.name,
        score: finalScore,
        entry,
        nameScore: name,
        finalScore,
        context,
      };
      if (
        !best ||
        candidate.finalScore > best.finalScore ||
        (candidate.finalScore === best.finalScore && candidate.nameScore > best.nameScore)
      ) {
        best = candidate;
      }
    }
  }
  return best;
}

function contextReasons(match: ContextualMatch, threshold: number): string[] {
  const reasons: string[] = [
    `${match.party} "${match.partyName}" name score ${match.nameScore.toFixed(2)} against "${match.matchedName}" (contextual score ${match.finalScore.toFixed(2)}, threshold ${threshold})`,
  ];
  const labels: Record<keyof Pick<ContextBreakdown, 'country' | 'address' | 'date' | 'route' | 'goods'>, string> = {
    country: 'country',
    address: 'address',
    date: 'date of birth or registration',
    route: 'route',
    goods: 'commodity or HS code',
  };
  for (const key of ['country', 'address', 'date', 'route', 'goods'] as const) {
    const signal = match.context[key];
    if (signal === 'match') {
      reasons.push(`supporting ${labels[key]}`);
    } else if (signal === 'conflict') {
      reasons.push(`conflicting ${labels[key]}`);
    }
  }
  return reasons;
}

/**
 * Combines the name score with explainable context. Missing fields are ignored
 * (not a penalty). A near-exact listed name with only a country mismatch still
 * hits, because a front address is cheap to fake. Conflicting registration or
 * date of birth can take a look-alike below the threshold.
 */
export function screenSanctionsContextual(
  input: SanctionsInput,
  catalog = loadSanctionsCatalog(),
): RuleResult {
  const match = bestContextualMatch(input, catalog);
  const score = match?.finalScore ?? 0;
  const hit = !!match && score >= catalog.threshold;
  const ruleVersion = catalog.contextualRuleVersion ?? 'sanctions-contextual.v1';
  return {
    check: 'SANCTIONS',
    outcome: hit ? 'HIT' : 'PASS',
    ruleVersion,
    score,
    reasons: hit && match ? contextReasons(match, catalog.threshold) : [],
    inputs: {
      shipper: input.shipper ?? null,
      consignee: input.consignee ?? null,
      mode: 'contextual',
      match: match
        ? {
            party: match.party,
            partyName: match.partyName,
            matchedName: match.matchedName,
            nameScore: match.nameScore,
            finalScore: match.finalScore,
            context: match.context,
          }
        : null,
      threshold: catalog.threshold,
    },
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

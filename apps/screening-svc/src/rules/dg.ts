import { loadCatalog } from './load-catalog';
import { RuleResult } from './types';

export type DgCatalog = {
  ruleVersion: string;
  entries: { unNumber: string; forbiddenOn: string[] }[];
};

export type DgInput = {
  unNumber?: string | null;
  aircraftType?: string | null;
};

let cached: DgCatalog | undefined;

export function loadDgCatalog(): DgCatalog {
  if (!cached) {
    cached = loadCatalog<DgCatalog>('dg-list.v1.json');
  }
  return cached;
}

export function normalizeUnNumber(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const digits = value.toUpperCase().replace(/[^0-9]/g, '');
  if (!digits) {
    return undefined;
  }
  return `UN${digits.padStart(4, '0')}`;
}

export function checkDg(input: DgInput, catalog = loadDgCatalog()): RuleResult {
  const aircraftType = (input.aircraftType ?? 'PASSENGER').toUpperCase();
  const unNumber = normalizeUnNumber(input.unNumber);
  const inputs = { unNumber: unNumber ?? null, aircraftType };
  if (!unNumber) {
    return {
      check: 'DG',
      outcome: 'PASS',
      ruleVersion: catalog.ruleVersion,
      reasons: [],
      inputs,
    };
  }
  const entry = catalog.entries.find(
    (item) => normalizeUnNumber(item.unNumber) === unNumber,
  );
  const forbidden = entry?.forbiddenOn.map((item) => item.toUpperCase()) ?? [];
  if (entry && forbidden.includes(aircraftType)) {
    return {
      check: 'DG',
      outcome: 'HIT',
      ruleVersion: catalog.ruleVersion,
      reasons: [
        `${unNumber} is forbidden on ${aircraftType} aircraft (${catalog.ruleVersion})`,
      ],
      inputs,
    };
  }
  return {
    check: 'DG',
    outcome: 'PASS',
    ruleVersion: catalog.ruleVersion,
    reasons: [],
    inputs,
  };
}

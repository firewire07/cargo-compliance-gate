export type CheckType = 'DG' | 'EMBARGO' | 'SANCTIONS';
export type CheckOutcome = 'PASS' | 'HIT';

export type RuleResult = {
  check: CheckType;
  outcome: CheckOutcome;
  ruleVersion: string;
  score?: number;
  reasons: string[];
  inputs: Record<string, unknown>;
};

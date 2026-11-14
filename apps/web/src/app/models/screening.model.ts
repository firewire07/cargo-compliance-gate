export interface ScreeningResult {
  id: string;
  awb: string;
  shipmentVersion: number;
  check: string;
  outcome: 'PASS' | 'HIT' | string;
  ruleVersion: string;
  score?: number | null;
  reasons: string[];
  inputs?: unknown;
  createdAt: string;
}

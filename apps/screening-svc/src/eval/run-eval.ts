/**
 * Offline sanctions evaluation. Talks only to the rule functions and the
 * synthetic dataset — no Kafka, Postgres or running services required.
 *
 *   npm run eval
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  SanctionsInput,
  loadSanctionsCatalog,
  screenSanctions,
} from '../rules/sanctions';

type Label = 'HIT' | 'PASS';

type EvalCase = {
  awb: string;
  label: Label;
  category: string;
  note?: string;
  input: SanctionsInput;
};

type Dataset = {
  synthetic: boolean;
  disclaimer: string;
  size: number;
  cases: EvalCase[];
};

type Counts = {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  alerts: number;
};

type ModeResult = {
  mode: 'name-only' | 'contextual';
  counts: Counts;
  precision: number;
  recall: number;
  fpr: number;
  falsePositives: EvalCase[];
  falseNegatives: EvalCase[];
};

function loadDataset(): Dataset {
  const candidates = [
    join(__dirname, '../../data/evaluation/synthetic-awbs.v1.json'),
    join(process.cwd(), 'apps/screening-svc/data/evaluation/synthetic-awbs.v1.json'),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) {
    throw new Error(`Evaluation dataset not found. Looked in: ${candidates.join(', ')}`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Dataset;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function evaluate(cases: EvalCase[], mode: 'name-only' | 'contextual'): ModeResult {
  const catalog = loadSanctionsCatalog();
  const counts: Counts = { tp: 0, fp: 0, fn: 0, tn: 0, alerts: 0 };
  const falsePositives: EvalCase[] = [];
  const falseNegatives: EvalCase[] = [];
  for (const row of cases) {
    const predicted = screenSanctions(row.input, mode, catalog).outcome as Label;
    if (predicted === 'HIT') {
      counts.alerts += 1;
    }
    if (row.label === 'HIT' && predicted === 'HIT') {
      counts.tp += 1;
    } else if (row.label === 'PASS' && predicted === 'HIT') {
      counts.fp += 1;
      falsePositives.push(row);
    } else if (row.label === 'HIT' && predicted === 'PASS') {
      counts.fn += 1;
      falseNegatives.push(row);
    } else {
      counts.tn += 1;
    }
  }
  return {
    mode,
    counts,
    precision: ratio(counts.tp, counts.tp + counts.fp),
    recall: ratio(counts.tp, counts.tp + counts.fn),
    fpr: ratio(counts.fp, counts.fp + counts.tn),
    falsePositives,
    falseNegatives,
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printMode(result: ModeResult): void {
  const { tp, fp, fn, tn, alerts } = result.counts;
  console.log(`\n${result.mode}`);
  console.log('                Predicted PASS    Predicted HIT');
  console.log(`  Actual PASS          ${String(tn).padStart(4)}             ${String(fp).padStart(4)}`);
  console.log(`  Actual HIT           ${String(fn).padStart(4)}             ${String(tp).padStart(4)}`);
  console.log(
    `  Precision ${pct(result.precision)}   Recall ${pct(result.recall)}   FPR ${pct(result.fpr)}   Alerts ${alerts}`,
  );
  if (result.falseNegatives.length) {
    console.log(
      `  Missed hits: ${result.falseNegatives.map((row) => `${row.awb} (${row.category})`).join(', ')}`,
    );
  }
  if (result.falsePositives.length) {
    console.log(
      `  Residual false positives: ${result.falsePositives.map((row) => `${row.awb} (${row.category})`).join(', ')}`,
    );
  }
}

function main(): void {
  const dataset = loadDataset();
  if (!dataset.synthetic) {
    throw new Error('Refusing to evaluate a dataset that is not marked synthetic.');
  }
  const cases = dataset.cases;
  const byCategory = new Map<string, number>();
  const byLabel = new Map<string, number>();
  for (const row of cases) {
    byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + 1);
    byLabel.set(row.label, (byLabel.get(row.label) ?? 0) + 1);
  }

  console.log('Synthetic sanctions evaluation (offline, no Kafka)');
  console.log(dataset.disclaimer);
  console.log(`Cases: ${cases.length}  (HIT ${byLabel.get('HIT') ?? 0}, PASS ${byLabel.get('PASS') ?? 0})`);
  console.log(
    `Mix: ${[...byCategory.entries()].map(([key, count]) => `${key} ${count}`).join(', ')}`,
  );

  const nameOnly = evaluate(cases, 'name-only');
  const contextual = evaluate(cases, 'contextual');
  printMode(nameOnly);
  printMode(contextual);

  const holdsSaved = nameOnly.counts.fp - contextual.counts.fp;
  const alertCut = nameOnly.counts.alerts - contextual.counts.alerts;
  const alertCutRate = ratio(alertCut, nameOnly.counts.alerts);
  const fpCutRate = ratio(holdsSaved, nameOnly.counts.fp);
  const recallKept = contextual.recall;

  console.log('\nComparison');
  console.log(
    `  Analyst holds saved: ${holdsSaved} of ${nameOnly.counts.fp} name-only false holds (${pct(fpCutRate)})`,
  );
  console.log(
    `  Alert volume cut by ${pct(alertCutRate)} (${nameOnly.counts.alerts} → ${contextual.counts.alerts}) at ${pct(recallKept)} recall`,
  );
  if (contextual.counts.fn > nameOnly.counts.fn) {
    console.log(
      `  Warning: contextual missed ${contextual.counts.fn - nameOnly.counts.fn} true hit(s) that name-only caught.`,
    );
  }
}

main();

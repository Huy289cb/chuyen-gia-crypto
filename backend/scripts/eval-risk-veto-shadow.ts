/**
 * OFFLINE EVALUATION ONLY: reads risk-veto shadow NDJSON plus a later daily
 * close CSV and prints the counterfactual PnL of applying the LLM multipliers.
 * No network, no exchange access, no writes.
 *
 * Usage:
 *   npx tsx scripts/eval-risk-veto-shadow.ts --prices <daily-closes.csv> \
 *     [--observations <observations.ndjson>] [--include-invalid] [--legs]
 */
import { readFile } from 'node:fs/promises';
import { riskVetoShadowFile } from '../src/services/openrouter-risk-veto-shadow.service';
import {
  dailyCloseLookupFromCsv, evaluateRiskVetoShadow, parseRiskVetoObservationsNdjson,
} from '../src/portfolio/risk-veto-shadow-eval';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const pricesPath = arg('--prices');
  if (!pricesPath) throw new Error('--prices <daily-closes.csv> is required');
  const observationsPath = arg('--observations') ?? riskVetoShadowFile();
  const observations = parseRiskVetoObservationsNdjson(await readFile(observationsPath, 'utf8'));
  const lookup = dailyCloseLookupFromCsv(await readFile(pricesPath, 'utf8'));
  const result = evaluateRiskVetoShadow(observations, lookup, { includeInvalid: process.argv.includes('--include-invalid') });
  const { legs, ...summary } = result;
  console.log(JSON.stringify({ mode: 'offline_evaluation', observationsPath, pricesPath, ...summary,
    ...(process.argv.includes('--legs') ? { legs } : {}) }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

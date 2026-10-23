import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { buildSourceTargets } from '../src/portfolio/source-momentum';
import { parseDailyPriceCsv } from '../src/portfolio/market-data';

const repo = path.resolve(__dirname, '../..');
const source = path.join(repo, 'docs/audits/futures-quick-win/source-replication-20261014T032757Z');
const panel = parseDailyPriceCsv(readFileSync(path.join(source, 'data/prices.csv'), 'utf8'));
const lines = readFileSync(path.join(source, 'source-audit/rankweights.csv'), 'utf8').trim().split(/\r?\n/);
const symbols = lines.shift()!.split(',').slice(1);
let checked = 0; let maxError = 0;
for (const line of lines) {
  const [label, ...values] = line.split(',');
  const targets = buildSourceTargets(panel, Date.parse(`${label}T00:00:00Z`) + 86_400_000);
  symbols.forEach((symbol, i) => {
    const error = Math.abs(targets.weights[symbol] - Number(values[i]));
    maxError = Math.max(maxError, error); checked++;
    if (error > 1e-13) throw new Error(`Source weight mismatch ${label} ${symbol}: ${error}`);
  });
}
const report = { status: 'PASS', check: 'new_ts_signal_vs_frozen_source_rankweights', rows: lines.length,
  weightsChecked: checked, maxAbsoluteError: maxError, newFinancialRuns: 0, utc: new Date().toISOString() };
const output = path.join(repo, 'docs/audits/futures-quick-win/momentum-paper-implementation-20261014T043000Z/receipts/source-parity.json');
mkdirSync(path.dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));

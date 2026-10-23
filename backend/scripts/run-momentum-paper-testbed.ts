#!/usr/bin/env tsx
/** Public/offline momentum portfolio testbed. Does not load.env or trading API. */
import { resolve, join } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { collectHistoricalMarketData } from '../src/portfolio/market-data';
import { runHistoricalPaperTestbed } from '../src/portfolio/historical-replay';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const option = (name: string): string | undefined => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const packageDir = resolve(option('package-dir') ?? '../docs/audits/futures-quick-win/momentum-paper-implementation-20261014T043000Z');
  const dataDir = resolve(option('data-dir') ?? join(packageDir, 'data'));
  if (args.includes('--collect-only')) {
    const manifest = await collectHistoricalMarketData({ directory: dataDir,
      startTimeMs: Date.parse('2026-09-29T17:00:00.000Z'), endTimeMs: Date.parse('2026-10-13T17:00:00.000Z'),
      dailyCsvPath: option('daily-csv'), onProgress: (completed, total) => console.log(JSON.stringify({ phase: 'data', completed, total })) });
    console.log(JSON.stringify({ status: manifest.status, bars: manifest.rawCandles, fundingEvents: manifest.fundingEvents }));
    return;
  }
  // Completed reports describe their frozen version. Operational/UI fixes do not rerun it.
  const outputDir = resolve(option('output-dir') ?? join(packageDir, 'outputs'));
  const reportPath = join(outputDir, 'report.json');
  let cached = false;
  try { await access(reportPath); cached = true; } catch { /* New run requires registration below. */ }
  if (cached) {
    const raw = await readFile(reportPath);
    const manifest = JSON.parse(await readFile(join(packageDir, 'artifact-manifest.json'), 'utf8')) as { files: Array<{ path: string; sha256: string }> };
    const entry = manifest.files.find(item => resolve(packageDir, item.path) === reportPath);
    if (!entry || entry.sha256 !== createHash('sha256').update(raw).digest('hex')) throw new Error('Cached financial report is not the frozen artifact');
    const report = JSON.parse(raw.toString('utf8')) as { protocolSha256: string };
    const protocol = await readFile(resolve(option('protocol') ?? join(dataDir, '..', 'protocol.json')));
    if (report.protocolSha256 !== createHash('sha256').update(protocol).digest('hex')) throw new Error('Cached report protocol mismatch');
    console.log(JSON.stringify({ status: 'REUSED_FROZEN_REPORT_NO_FINANCIAL_RERUN', report: JSON.parse(raw.toString('utf8')) }, null, 2));
    return;
  }
  const report = await runHistoricalPaperTestbed({ dataDir, outputDir,
    dailyCsvPath: option('daily-csv'), protocolPath: option('protocol'),
    onProgress: (progress) => console.log(JSON.stringify({ phase: 'replay', ...progress })) });
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });

#!/usr/bin/env tsx
/** Offline CCT integration registration/replay. No dotenv, private API, or process manager. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { CCT_PAPER_POLICY } from '../src/portfolio/policy-registry';
import { CCT_SOURCE_SYMBOLS } from '../src/portfolio/source-cct';
import { CCT_TESTBED_WINDOWS, runCctHistoricalPaperTestbed } from '../src/portfolio/cct-historical-replay';
import type { CctReplayProtocol, CctTestbedWindowId } from '../src/portfolio/cct-historical-replay';

async function digest(path: string): Promise<string> { const hash = createHash('sha256'); for await (const b of createReadStream(path)) hash.update(b); return hash.digest('hex'); }
async function main(): Promise<void> {
  const args = process.argv.slice(2), option = (key: string): string | undefined => args.find(s => s.startsWith(`--${key}=`))?.slice(key.length + 3);
  const packageDir = option('package-dir'); if (!packageDir) throw new Error('Explicit isolated --package-dir is required');
  const directory = resolve(packageDir), protocolPath = resolve(option('protocol') ?? join(directory, 'protocol.json'));
  if (args.includes('--register')) {
    const windowId = option('window') as CctTestbedWindowId; if (!(windowId in CCT_TESTBED_WINDOWS)) throw new Error('Choose registered --window=dev64|prior64|continuous128');
    const research = resolve(option('research-dir') ?? '/home/ubuntu/futures-improvement-20261015');
    const prior = windowId !== 'dev64', main = windowId !== 'prior64';
    const minuteShards = [...(prior ? [{ manifestPath: join(research, 'cct-confirmation-data/build-manifest.json') }] : []), ...(main ? [{ manifestPath: join(research, 'cct-minute-data/manifest.json') }] : [])];
    const targetsPaths = [...(prior ? [join(research, 'cct-confirmation-targets/targets-64d.ndjson')] : []), ...(main ? [join(research, 'cct-candidate/long_cash/targets-64d.ndjson')] : [])];
    const frozenData = resolve(__dirname, '../../docs/audits/futures-quick-win/momentum-paper-64d-20261014T140124Z/data');
    const fundingPaths = [...(prior ? CCT_SOURCE_SYMBOLS.map(s => join(research, 'cct-confirmation-data', `${s}-funding.json`)) : []), ...(main ? CCT_SOURCE_SYMBOLS.map(s => join(frozenData, `${s}-funding.json`)) : [])];
    const filtersPath = join(frozenData, 'exchange-info.json');
    const referenceDir = option('reference-dir');
    const referencePrefix = option('reference-prefix') ?? (windowId === 'continuous128' ? 'lc_continuous128' : windowId === 'prior64' ? 'lc_buffer11_confirmation' : 'lc_buffer11');
    const parityReferences = referenceDir ? Object.fromEntries((['base','stress'] as const).map(name => [name,
      Object.fromEntries([['framesPath','frames.ndjson'],['eventsPath','events.ndjson'],['summaryPath','summary.json']].map(([key, suffix]) => [key, join(resolve(referenceDir), `${referencePrefix}_${name}-${suffix}`)]))])) as CctReplayProtocol['parityReferences'] : undefined;
    const portfolioDir = resolve(__dirname, '../src/portfolio');
    const paths = new Set([__filename, resolve(__dirname, '../package.json'), resolve(__dirname, '../package-lock.json'),
      ...['paper-engine.ts','types.ts','policy-registry.ts','target-projection.ts','source-cct.ts','cct-types.ts','cct-historical-replay.ts'].map(file => join(portfolioDir, file)),
      ...minuteShards.map(s => s.manifestPath), ...targetsPaths, ...fundingPaths, filtersPath,
      ...Object.values(parityReferences ?? {}).flatMap(ref => Object.values(ref))]);
    for (const shard of minuteShards) { const manifest = JSON.parse(await readFile(shard.manifestPath, 'utf8')) as { mainFiles: Array<{ path: string }> }; for (const f of manifest.mainFiles) paths.add(resolve(shard.manifestPath, '..', f.path)); }
    const inputs: CctReplayProtocol['inputs'] = [];
    for (const path of paths) inputs.push({ path, sha256: await digest(path) });
    const protocol: CctReplayProtocol = { status: 'REGISTERED_BEFORE_TS_REPLAY', policyId: CCT_PAPER_POLICY.id, windowId,
      commonConfig: CCT_PAPER_POLICY, cases: { base: { feeRate: '0.0005', slippageBps: '2' }, stress: { feeRate: '0.0007', slippageBps: '5' } },
      data: { minuteShards, targetsPaths, targetWeightMultiplier: '1.5', fundingPaths, filtersPath },
      inputs, monetaryToleranceUsd: '1e-20', ...(parityReferences ? { parityReferences } : {}) };
    await mkdir(directory, { recursive: true });
    await writeFile(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ status: protocol.status, protocolPath, protocolSha256: await digest(protocolPath), windowId, inputs: inputs.length, parityReferences: Boolean(parityReferences), financialReplayStarted: false }));
    return;
  }
  if (!args.includes('--run')) throw new Error('Explicit --register or --run required');
  const report = await runCctHistoricalPaperTestbed({ protocolPath, outputDir: resolve(option('output-dir') ?? join(directory, 'outputs')),
    onProgress: p => console.log(JSON.stringify({ phase: 'shared-ts-cct-replay', ...p })) });
  console.log(JSON.stringify({ status: report.status, policyId: report.policyId, windowId: report.windowId,
    cases: Object.fromEntries(Object.entries(report.cases).map(([name, c]) => [name, { summary: c.summary, parity: c.parity, metrics: c.metrics }])) }, null, 2));
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });

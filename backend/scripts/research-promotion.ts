/** Offline only. Run from backend. Never imports runtime, DB, provider or exchange clients. */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { evaluateResearchPromotion, type ResearchFreeze, type ResearchEvidence } from '../src/backtest/research-promotion';

const hash = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
function sourceManifest() {
  const paths: string[] = [];
  function walk(dir: string) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, ent.name);
      if (ent.isDirectory()) walk(path);
      else if (/\.(ts|js|cjs|py)$/.test(ent.name)) paths.push(relative(process.cwd(), path));
    }
  }
  walk('src'); walk('scripts');
  paths.push('package-lock.json', 'tsconfig.json');
  return Object.fromEntries(paths.sort().map(p => [p, hash(readFileSync(p))]));
}
function main() {
  const [command, inputPath, outputPath, evidencePath] = process.argv.slice(2);
  if (!inputPath || !outputPath || !['freeze','evaluate'].includes(command))
    throw new Error('Usage: tsx scripts/research-promotion.ts freeze SPEC.json NEW_MANIFEST.json | evaluate MANIFEST.json NEW_REPORT.json EVIDENCE.json');
  const sources = sourceManifest(), sourceHash = hash(JSON.stringify(sources));
  if (command === 'freeze') {
    const spec = JSON.parse(readFileSync(inputPath, 'utf8'));
    if (!spec.hypothesis?.trim() || !spec.protocolFile || !Array.isArray(spec.supportingEvidence) || !spec.supportingEvidence.length ||
      spec.supportsFurtherResearch !== true || !Array.isArray(spec.consumedPeriods) || !spec.evaluationPeriod)
      throw new Error('A supported hypothesis, evidence files, protocol, consumed-period inventory and evaluation period are required');
    const period = (p: {from:number;through:number}) => !!p && Number.isFinite(p.from) && Number.isFinite(p.through) && p.from < p.through;
    if (!period(spec.evaluationPeriod) || spec.consumedPeriods.some((p: {from:number;through:number}) => !period(p) ||
      p.from < spec.evaluationPeriod.through && p.through > spec.evaluationPeriod.from))
      throw new Error('Evaluation period invalid or overlaps consumed data; do not relabel reused data as independent');
    const evidenceHashes = Object.fromEntries(spec.supportingEvidence.map((p: string) => [p, hash(readFileSync(p))]));
    const protocolHash = hash(readFileSync(spec.protocolFile));
    const manifest: ResearchFreeze = { frozenAt: Date.now(), sourceHash, protocolHash,
      hypothesis: spec.hypothesis, supportingEvidence: spec.supportingEvidence,
      policy: { symbol: 'BTC', cooldownMinutes: 60, dailyPercent: 10, maxRiskPercent: 3, targetPercent: .5, maxRiskUsd: null } };
    writeFileSync(outputPath, JSON.stringify({ ...manifest, sources, evidenceHashes,
      protocolFile: spec.protocolFile, consumedPeriods: spec.consumedPeriods, evaluationPeriod: spec.evaluationPeriod,
      specHash: hash(readFileSync(inputPath)), reservedTestAccess: false, deploymentAuthorized: false }, null, 2), { flag: 'wx' });
    console.log('Frozen research sources and protocol. No evaluation or deployment performed.');
  } else {
    if (!evidencePath) throw new Error('Evidence file required');
    const manifest = JSON.parse(readFileSync(inputPath, 'utf8'));
    if (manifest.sourceHash !== sourceHash || manifest.protocolHash !== hash(readFileSync(manifest.protocolFile)) ||
      Object.entries(manifest.evidenceHashes as Record<string,string>).some(([p,h]) => hash(readFileSync(p)) !== h))
      throw new Error('Frozen source/protocol/supporting evidence changed; evaluation rejected');
    const e: ResearchEvidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    if (e.base.candidate.from !== manifest.evaluationPeriod.from || e.base.candidate.through !== manifest.evaluationPeriod.through)
      throw new Error('Evaluation window differs from frozen protocol');
    const result = evaluateResearchPromotion(manifest, e);
    writeFileSync(outputPath, JSON.stringify({ ...result, checkedAt: new Date().toISOString(),
      manifestHash: hash(readFileSync(inputPath)), evidenceHash: hash(readFileSync(evidencePath)) }, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ researchPass: result.researchPass, failures: result.failures }));
    if (!result.researchPass) process.exitCode = 2;
  }
}
main();

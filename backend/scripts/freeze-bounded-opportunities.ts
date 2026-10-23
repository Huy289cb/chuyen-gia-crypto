import 'dotenv/config';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getAiOpportunityPolicy} from '../src/config/ai-opportunity-policy';
const {createSourceGuard}=require('./testbed-source-guard.cjs');
const out='../docs/audits/2026-09-11-opportunity-testbed/independent-2023/';
const protocol='../docs/audits/2026-09-13-bounded-research/protocol.md';
const policy=getAiOpportunityPolicy();
if(!policy.pinned || policy.targetPercent!==.5)throw new Error('owner_policy_changed');
mkdirSync(out,{recursive:true});
writeFileSync(out+'freeze.json',JSON.stringify({
  frozenAt:new Date().toISOString(), candidates:['opening_range_breakout','opening_range_failure'],
  policyHash:policy.hash, sourceHashes:createSourceGuard(['src','scripts/run-opportunity-portfolio.ts','scripts/testbed-source-guard.cjs']).initial,
  protocolHash:createHash('sha256').update(readFileSync(protocol)).digest('hex'),
  preparationHashes:Object.fromEntries(['download-opportunity-train.py','prepare-opportunity-train.py'].map(p=>[p,createHash('sha256').update(readFileSync('scripts/'+p)).digest('hex')])),
  evaluation:['2023-01-01','2023-07-01'],warmup:['2022-12-01','2023-01-01'],
  priorUseAudit:'Searched repository docs/scripts dates and filenames for 2023/2022; no earlier matching data or evaluation artifact found. This is a repository-scoped check, not proof of universal independence.',
  trainDecision:'Both hypotheses failed TRAIN; independent results are descriptive and cannot rescue rejection or authorize reserved-test access.',
  costs:['base','stress'],initialWallet:33.59964603,retuningAllowed:false,reservedTestAccess:false,promotionEligible:false,
},null,2)+'\n',{flag:'wx'});
console.log('Frozen two hypotheses before independent data access.');

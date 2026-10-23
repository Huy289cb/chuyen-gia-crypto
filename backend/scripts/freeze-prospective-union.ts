import 'dotenv/config';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getAiOpportunityPolicy} from '../src/config/ai-opportunity-policy';
import {AI_OPPORTUNITY_PROMPT} from '../src/utils/ai-opportunity';
const old='../docs/audits/2026-09-12-prospective-opportunity/',out='../docs/audits/2026-09-13-prospective-union/';
const prior=JSON.parse(readFileSync(old+'session-1789158328471.json','utf8')),policy=getAiOpportunityPolicy();
if(Date.now()<prior.stopAt||readdirSync(old).some(f=>f.startsWith('quota-')))throw new Error('prior_cohort_not_budget_clear');
if(!policy.pinned||policy.hash!==prior.policyHash)throw new Error('policy_changed');
mkdirSync(out,{recursive:true});
const binary=readFileSync('research-bundles/prospective-v2.cjs');
const protocol={version:'btc-prospective-v2-union',frozenAt:new Date().toISOString(),durationHours:24,
 collectorSha256:createHash('sha256').update(binary).digest('hex'),promptHash:createHash('sha256').update(AI_OPPORTUNITY_PROMPT).digest('hex'),
 model:policy.model,policyHash:policy.hash,paperWallet:33.59964603,maxRequestsPerIctDay:12,maxRequestsPerUtcHour:1,
 selection:'Union of baseline EMA/breakout, all-confirmed target variants, structure reclaim; preserve baseline objects on execution-ID collision. Deterministic risk/setup/ID ranking. AI may choose exactly one supplied plan or abstain.',
 priorCohort:'v1 completed with zero claims; no overlapping provider quota consumed. Separate artifacts and protocol.',
 inference:'Measure latency and known/unknown costs; record every candidate and match deterministic/AI outcomes at the same response time. Not portfolio ROI.',
 riskCapsChanged:false,execution:false,promotionEligible:false,
 limitations:['Fixed hypothetical wallet, no live admission authorization.','TRAIN deterministic union was negative; this is a prospective test of AI selection, not a proven profitable strategy.','Original OOS sample-size/statistical/risk/parity requirements remain; one24h sample cannot authorize live trading.']};
writeFileSync(out+'protocol.json',JSON.stringify(protocol,null,2)+'\n',{flag:'wx'});
writeFileSync(out+'collector-source-v2.cjs',binary,{flag:'wx'});
console.log('v2 frozen; prior cohort quota verified zero.');

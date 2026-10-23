import 'dotenv/config';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {getAiOpportunityPolicy} from '../src/config/ai-opportunity-policy';
const {createSourceGuard}=require('./testbed-source-guard.cjs');
const root='../docs/audits/2026-09-11-opportunity-testbed/',out=root+'supplemental-2024/';
const policy=getAiOpportunityPolicy(),prior=JSON.parse(readFileSync(root+'validation/freeze.json','utf8'));
if(!policy.pinned||policy.hash!==prior.policyHash)throw new Error('candidate_policy_changed');
mkdirSync(out,{recursive:true});
const freeze={frozenAt:new Date().toISOString(),candidate:prior.candidate,selector:'EMA only',policyHash:policy.hash,
 sourceHashes:createSourceGuard(['src','scripts/run-opportunity-portfolio.ts','scripts/testbed-source-guard.cjs']).initial,
 period:['2024-07-01','2025-01-01'],warmup:['2024-06-01','2024-07-01'],initialWallet:33.59964603,
 costs:['base','stress'],selection:'One previously frozen candidate; no retuning on this period.',
 interpretation:'Reverse-time supplemental generalization, not prospective profitability. Period chosen for additional coverage; no claim to an unbiased calendar sample.',
 priorValidation:'July-September2025 consumed; zero trades and no efficacy result. Not replaced by this supplement.',
 requirements:'Positive base/stress, adequate samples and stable week results are necessary diagnostics, not sufficient for live promotion. Original OOS, risk and execution-parity requirements remain.',
 reserved2025TestAccess:false,promotionEligible:false};
writeFileSync(out+'freeze.json',JSON.stringify(freeze,null,2)+'\n',{flag:'wx'});
console.log('Supplemental candidate frozen before archive access.');

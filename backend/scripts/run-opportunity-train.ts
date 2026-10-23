// Offline exact runtime builder, independent all-plan outcomes. No provider/DB/exchange imports.
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getAiOpportunityPolicy } from '../src/config/ai-opportunity-policy';
import { buildOpportunitySnapshot, type OpportunityCandle, type OpportunitySnapshot } from '../src/utils/ai-opportunity';
import { evaluateOpportunityOutcome, type OpportunityOutcome } from '../src/backtest/opportunity-outcome';
import type { ReplayFunding } from '../src/backtest/replay-account';
const root='../docs/audits/2026-09-11-opportunity-testbed/';
const diagnosticRun=process.argv.includes('--diagnostics'),diagnostics:Record<string,number>={};
const prefix=diagnosticRun?'diagnostics-':'';
const raw=readFileSync(root+'train-data.json'), manifest=JSON.parse(readFileSync(root+'train-data-manifest.json','utf8'));
if(createHash('sha256').update(raw).digest('hex')!==manifest.sha256) throw new Error('dataset_changed');
const data=JSON.parse(raw.toString()) as {byTf:Record<string,number[][]>;funding:ReplayFunding[]};
const policy={...getAiOpportunityPolicy(),mode:'shadow' as const};
if(!policy.pinned || policy.targetPercent!==.5) throw new Error('owner_policy_changed');
for(const key of Object.keys(process.env)) if(/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|DIRECT_URL/.test(key)) delete process.env[key];
process.env.BINANCE_ENABLED='false';
const candles:Record<string,OpportunityCandle[]>={};
for(const [tf,rows] of Object.entries(data.byTf)) candles[tf]=rows.map(b=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}));
const steps:Record<string,number>={'5m':300000,'15m':900000,'1h':3600000,'4h':14400000};
const pointers:Record<string,number>={'5m':0,'15m':0,'1h':0,'4h':0};
const wallet=33.59964603;
const outcomes: {asOf:number;setup:string;side:string;cost:string;deterministic:boolean;outcome:OpportunityOutcome}[]=[];
let fundingIndex=-1,snapshots=0,empty=0;
const seen=new Set<string>();
for(const b of candles['15m']) {
 const asOf=b.timestamp+900000,context={} as OpportunitySnapshot['candles'];
 for(const tf of Object.keys(steps)) {
  while(pointers[tf]<candles[tf].length && candles[tf][pointers[tf]].timestamp+steps[tf]<=asOf) pointers[tf]++;
  context[tf as keyof typeof context]=candles[tf].slice(Math.max(0,pointers[tf]-120),pointers[tf]);
 }
 if(Object.values(context).some(rows=>rows.length<100)) continue;
 while(fundingIndex+1<data.funding.length && data.funding[fundingIndex+1].time<=asOf) fundingIndex++;
 if(fundingIndex<0) continue;
 const s=buildOpportunitySnapshot({asOf,candles:context,policy,diagnostics:diagnosticRun?diagnostics:undefined,finance:{balance:wallet,remainingDailyRiskUsd:wallet*.1,
  remainingExposureUsd:policy.maxExposure,allowed:true,stepSize:.001,minQty:.001,minNotional:50,fundingRate:data.funding[fundingIndex].rate}});
 if(!s?.plans.length){empty++;continue;} if(seen.has(s.waveKey))continue;seen.add(s.waveKey);snapshots++;
 const start=Math.ceil((asOf+10000)/60000)*60000,first=(start-candles['1m'][0].timestamp)/60000;
 const bars=candles['1m'].slice(first,first+48*60);
 for(const p of s.plans)for(const slip of [.001,.002])outcomes.push({asOf,setup:p.setup,side:p.side,cost:slip===.001?'base':'stress',deterministic:p.id===s.deterministicPlanId,
  outcome:evaluateOpportunityOutcome(p,bars,{submittedAt:asOf+10000,entryExpiresAt:s.expiresAt,horizonAt:start+48*3600000,barMs:60000,feePerSide:.0005,slippageFraction:slip,funding:data.funding})});
}
const summaries=[];
for(const setup of ['ema_retest_confirmed','breakout_retest_confirmed','deterministic_lowest_risk'])for(const cost of ['base','stress']){
 const selected=outcomes.filter(r=>r.cost===cost&&(setup==='deterministic_lowest_risk'?r.deterministic:r.setup===setup)),closed=selected.filter(r=>r.outcome.status==='closed');
 summaries.push({setup,cost,plans:selected.length,closed:closed.length,unfilled:selected.filter(r=>r.outcome.status==='unfilled').length,censored:selected.filter(r=>r.outcome.status==='censored').length,
 ambiguous:closed.filter(r=>r.outcome.ambiguous).length,wins:closed.filter(r=>r.outcome.netUsd!>0).length,counterfactualNetUsd:closed.reduce((s,r)=>s+r.outcome.netUsd!,0),meanNetUsd:closed.length?closed.reduce((s,r)=>s+r.outcome.netUsd!,0)/closed.length:null});
}
const report={diagnostics,datasetSha256:manifest.sha256,policyHash:policy.hash,snapshots,empty,summaries,promotionEligible:false,
 limitations:['TRAIN only, no holdout used.','Independent fixed-wallet counterfactuals overlap: sum is NOT account ROI; no portfolio/circuit replay yet.',
 'Funding filter uses last settled rate, not contemporaneous predicted funding; settlement mark approximated by minute open.',
 'Submission delay10seconds and pending expiry3minutes are test assumptions; live pending TTL differs.','No historical AI choices fabricated; no inference-cost or AI increment claim.']};
writeFileSync(root+prefix+'train-all-plan-outcomes.json',JSON.stringify(outcomes));writeFileSync(root+prefix+'train-all-plan-summary.json',JSON.stringify(report,null,2)+'\n');
writeFileSync(root+(diagnosticRun?'trial-003-source-hashes.json':'trial-001-source-hashes.json'),JSON.stringify(Object.fromEntries([__filename,'src/utils/ai-opportunity.ts','src/backtest/opportunity-outcome.ts'].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')])),null,2)+'\n');
console.log(JSON.stringify(report,null,2));

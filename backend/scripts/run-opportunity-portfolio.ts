import 'dotenv/config';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getAiOpportunityPolicy} from '../src/config/ai-opportunity-policy';
import {getRiskPolicy} from '../src/config/risk-policy';
import {getPendingOrderTtlHours,getPendingOrderMaxDriftPct} from '../src/config/pending-order-policy';
import {buildOpportunitySnapshot,buildResearchOpportunitySnapshot,type OpportunityCandle,type OpportunitySnapshot} from '../src/utils/ai-opportunity';
import {buildProspectiveCohort,buildDirectionalRegimeCohort,PROSPECTIVE_UNION_VERSION} from '../src/backtest/prospective-opportunity';
import {OpportunityPortfolio} from '../src/backtest/opportunity-portfolio';
import type {ReplayFunding} from '../src/backtest/replay-account';
const {createSourceGuard}=require('./testbed-source-guard.cjs');
const rrArgument=process.argv.find(arg=>arg.startsWith('--research-rr='));
if(rrArgument){
 const value=rrArgument.slice('--research-rr='.length);
 const rr=Number(value);
 if(!Number.isFinite(rr)||rr<1||rr>5)throw new Error('invalid_research_rr');
 process.env.AI_OPPORTUNITY_MIN_RR=value;
}
const sourceGuard=createSourceGuard(['src',__filename,'scripts/testbed-source-guard.cjs']);
const independent=process.argv.includes('--independent-2023');
const validation=process.argv.includes('--validation'),supplemental=process.argv.includes('--supplemental-2024');
if(Number(validation)+Number(supplemental)+Number(independent)>1)throw new Error('conflicting_evaluation_splits');
const evaluation=validation||supplemental||independent;
const out='../docs/audits/2026-09-11-opportunity-testbed/'+(independent?'independent-2023/':supplemental?'supplemental-2024/':validation?'validation/':'');
const split=independent?'independent-2023':supplemental?'supplemental-2024':validation?'validation':'train';
const validationStart=Date.parse(independent?'2023-01-01':supplemental?'2024-07-01':'2025-07-01'),validationEnd=Date.parse(independent?'2023-07-01':supplemental?'2025-01-01':'2025-10-01');
const walletSensitivity=process.argv.includes('--wallet-sensitivity');
const initialWallets=walletSensitivity?[33.59964603*.95,33.59964603*1.05]:[33.59964603];
const stressAdmission=walletSensitivity||process.argv.includes('--stress-aware-admission');
const directional=stressAdmission||process.argv.includes('--directional-regime');
const union=directional||process.argv.includes('--prospective-union');
const unbroken=process.argv.includes('--unbroken-targets');
const opening=process.argv.includes('--opening-range-breakout')?'opening_range_breakout' as const:process.argv.includes('--opening-range-failure')?'opening_range_failure' as const:null;
if(opening && ['--momentum-breakout','--unbroken-targets','--prospective-union','--directional-regime','--stress-aware-admission','--wallet-sensitivity','--structure-reclaim','--range-rejection','--all-confirmed-targets'].some(x=>process.argv.includes(x)))throw new Error('conflicting_research_variants');
if(process.argv.includes('--opening-range-breakout')&&process.argv.includes('--opening-range-failure'))throw new Error('conflicting_opening_variants');
const momentum=process.argv.includes('--momentum-breakout');
const reclaim=process.argv.includes('--structure-reclaim'),rangeRejection=process.argv.includes('--range-rejection');
const research=!!opening||unbroken||momentum||rangeRejection||reclaim||process.argv.includes('--all-confirmed-targets');
const rrPrefix=rrArgument?`rr-${process.env.AI_OPPORTUNITY_MIN_RR!.replace('.','_')}-`:'';
const prefix=rrPrefix+(opening?opening+'-':unbroken?'unbroken-targets-':momentum?'momentum-breakout-':walletSensitivity?'wallet-sensitivity-':stressAdmission?'stress-admission-':directional?'directional-regime-':union?'prospective-union-':rangeRejection?'range-rejection-':reclaim?'structure-reclaim-':research?'all-confirmed-':'');
const build=directional?(input:Parameters<typeof buildOpportunitySnapshot>[0])=>buildDirectionalRegimeCohort(input)?.snapshot??null:union?(input:Parameters<typeof buildOpportunitySnapshot>[0])=>buildProspectiveCohort(input,PROSPECTIVE_UNION_VERSION)?.snapshot??null:research?(input:Parameters<typeof buildOpportunitySnapshot>[0])=>buildResearchOpportunitySnapshot(input,opening??(unbroken?'unbroken_targets':momentum?'momentum_breakout':rangeRejection?'range_rejection':reclaim?'structure_reclaim':'all_confirmed_120')):buildOpportunitySnapshot;
if(evaluation){
 if(independent ? !opening : (opening||unbroken||momentum||union||reclaim||rangeRejection||!research))throw new Error('only_frozen_ema_candidate_allowed');
 const freeze=JSON.parse(readFileSync(out+'freeze.json','utf8'));
 if(JSON.stringify(freeze.sourceHashes)!==JSON.stringify(sourceGuard.initial))throw new Error('frozen_source_mismatch');
}
const raw=readFileSync(out+split+'-data.json'),manifest=JSON.parse(readFileSync(out+split+'-data-manifest.json','utf8'));
if(createHash('sha256').update(raw).digest('hex')!==manifest.sha256)throw new Error('changed_dataset');
const data=JSON.parse(raw.toString()) as {byTf:Record<string,number[][]>;funding:ReplayFunding[]};
const policy={...getAiOpportunityPolicy(),mode:'shadow' as const},risk=getRiskPolicy();
if(stressAdmission){
 policy.slippagePercent=Math.max(policy.slippagePercent,.2);
 policy.hash=createHash('sha256').update(policy.hash+':research-stress-admission:'+policy.slippagePercent).digest('hex');
}
if(!policy.pinned||policy.targetPercent!==.5)throw new Error('owner_policy_changed');
if(evaluation&&JSON.parse(readFileSync(out+'freeze.json','utf8')).policyHash!==policy.hash)throw new Error('frozen_policy_mismatch');
const ttlMs=getPendingOrderTtlHours('15m')*3600000,drift=getPendingOrderMaxDriftPct();
for(const key of Object.keys(process.env))if(/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|DIRECT_URL/.test(key))delete process.env[key];
process.env.BINANCE_ENABLED='false';
const candles:Record<string,OpportunityCandle[]>={};
for(const [tf,rows]of Object.entries(data.byTf))candles[tf]=rows.map(b=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}));
const steps:Record<string,number>={'5m':300000,'15m':900000,'1h':3600000,'4h':14400000};
const circuit={maxDrawdownPercent:risk.maxDrawdownPercent,drawdownEnabled:risk.circuitDrawdownEnabled,
 expectancyEnabled:risk.circuitExpectancyKillEnabled,expectancyWindow:risk.circuitExpectancyWindow,
 expectancyMinSumR:risk.circuitExpectancyMinSumR,maxExposurePercentOfEquity:risk.maxExposurePercentOfEquity};
const reports=[];
for(const initialWallet of initialWallets)for(const setup of (opening?[opening]:momentum?['momentum_breakout_confirmed']:union?['deterministic_lowest_risk']:evaluation?['ema_retest_confirmed']:rangeRejection?['range_rejection_confirmed']:reclaim?['structure_reclaim_confirmed']:['ema_retest_confirmed','breakout_retest_confirmed','deterministic_lowest_risk']))for(const slip of [.001,.002]){
 const ledger=new OpportunityPortfolio(initialWallet,policy,circuit,.0005,slip),pointers:Record<string,number>={'5m':0,'15m':0,'1h':0,'4h':0};
 const candidateDiagnostics:Record<string,number>={};
 const blocks:Record<string,number>={},count=(k:string)=>blocks[k]=(blocks[k]??0)+1;
 const waves=new Set<string>(),requestsPerDay=new Map<number,number>();
 let fundingIndex=0,latestRate=NaN,submittedAt=0,ambiguous=0,unfilled=0;
 const equityCurve:{time:number;wallet:number;equity:number}[]=[],events:Record<string,unknown>[]=[];
 const settle=(until:number,mark:number)=>{
  while(fundingIndex<data.funding.length&&data.funding[fundingIndex].time<=until){
   const f=data.funding[fundingIndex++];ledger.advance(f.time,mark);ledger.fund(f.rate,f.markPrice);latestRate=f.rate;
  }
 };
 for(const b of candles['1m']){
  const t=b.timestamp,end=t+60000;
  settle(t,b.open);ledger.advance(t,b.open);
  if(ledger.pending && t%300000===0 && (t-submittedAt>=ttlMs || Math.abs(b.open-ledger.pending.entry)/ledger.pending.entry>=drift)){
   const reason=t-submittedAt>=ttlMs?'ttl_cancel':'drift_cancel';ledger.cancel();unfilled++;count(reason);events.push({time:t,type:reason});
  }
  let intrabarEntry=false;
  if(ledger.pending && t>=Math.ceil(submittedAt/60000)*60000){
   const p=ledger.pending,dir=p.side==='long'?1:-1,marketable=dir*(b.open-p.entry)<=0;
   if(marketable||(dir===1?b.low<=p.entry:b.high>=p.entry)){
    intrabarEntry=!marketable;ledger.fill();events.push({time:t,type:'fill',plan:p});
   }
  }
  let exit:{price:number;time:number;reason:string}|null=null;
  if(ledger.holding){
   const h=ledger.holding,p=h.plan,dir=p.side==='long'?1:-1;
   const stop=dir===1?b.low<=p.stopLoss:b.high>=p.stopLoss,target=dir===1?b.high>=p.takeProfit:b.low<=p.takeProfit;
   if(dir*(b.open-p.stopLoss)<=0)exit={price:b.open,time:t,reason:'gap_stop'};
   else if(!intrabarEntry&&dir*(b.open-p.takeProfit)>=0)exit={price:p.takeProfit,time:t,reason:'gap_target'};
   else if(stop){if(target||intrabarEntry)ambiguous++;exit={price:p.stopLoss,time:end,reason:target||intrabarEntry?'ambiguous_stop_first':'stop'};}
   else if(target&&!intrabarEntry)exit={price:p.takeProfit,time:end,reason:'target'};
   else if(end-h.entryTime>=48*3600000)exit={price:b.close,time:end,reason:'time_exit'};
   else if(target&&intrabarEntry)ambiguous++;
  }
  if(exit){settle(exit.time,exit.price);ledger.advance(exit.time,exit.price);events.push({...ledger.close(exit.price),type:'close',reason:exit.reason});}
  settle(end,b.close);ledger.advance(end,b.close);
  if(end%3600000===0&&(!evaluation||end>=validationStart))equityCurve.push({time:end,wallet:ledger.wallet,equity:ledger.equity});
  if(end%900000!==0)continue;
  const context={} as OpportunitySnapshot['candles'];
  for(const tf of Object.keys(steps)){
   while(pointers[tf]<candles[tf].length&&candles[tf][pointers[tf]].timestamp+steps[tf]<=end)pointers[tf]++;
   context[tf as keyof typeof context]=candles[tf].slice(Math.max(0,pointers[tf]-120),pointers[tf]);
  }
  if(evaluation&&(end<validationStart||end>=validationEnd))continue;
  if(Object.values(context).some(rows=>rows.length<100)||!Number.isFinite(latestRate))continue;
  const block=ledger.block();if(block){count(block);continue;}
  const wave=`BTC:${Math.floor(end/3600000)}`,day=Math.floor((end+7*3600000)/86400000);
  if(waves.has(wave)||(requestsPerDay.get(day)??0)>=policy.dailyRequests){count('quota');continue;}
  const s=build({asOf:end,candles:context,finance:ledger.finance(latestRate),policy,diagnostics:candidateDiagnostics});
  const p=setup==='deterministic_lowest_risk'?s?.plans[0]:s?.plans.find(p=>p.setup===setup);
  if(!p){count('no_plan');continue;}
  const reserved=ledger.reserve(p,latestRate);if(reserved){count(reserved);continue;}
  waves.add(wave);requestsPerDay.set(day,(requestsPerDay.get(day)??0)+1);submittedAt=end+10000;
  events.push({time:end,type:'reserve',plan:p,wallet:ledger.wallet,dayStart:ledger.dayStart});
 }
 const cost=slip===.001?'base':'stress',walletTag=walletSensitivity?`wallet-${initialWallet.toFixed(8)}-`:'';
 const summary={split,setup,cost,initialWallet,pendingTtlMinutes:ttlMs/60000,trades:ledger.closes.length,wins:ledger.closes.filter(c=>c.netUsd>0).length,
  wallet:ledger.wallet,equity:ledger.equity,netCashUsd:ledger.wallet-ledger.initialWallet,roiEquityPercent:(ledger.equity/ledger.initialWallet-1)*100,
  maxMinuteCloseDrawdownPercent:ledger.maxDrawdownPercent,ambiguous,unfilled,pending:!!ledger.pending,open:!!ledger.holding,blocks,candidateDiagnostics};
 sourceGuard.verify();reports.push(summary);writeFileSync(out+prefix+walletTag+`portfolio-${setup}-${cost}.json`,JSON.stringify({summary,events,equityCurve,closes:ledger.closes}));console.log(JSON.stringify(summary));
}
const report={targetHistory:unbroken?'unbroken_confirmed_120':union?'union_recent_two_and_all_confirmed_120':research&&!rangeRejection?'all_confirmed_120':'recent_two',minRr:policy.minRr,admissionSlippagePercent:policy.slippagePercent,signalFamily:opening??(momentum?'momentum_breakout':stressAdmission?'stress_admission_directional_union':directional?'directional_regime_union':union?'prospective_v2_union':rangeRejection?'range_rejection':reclaim?'structure_reclaim':'ema_breakout'),dataHash:manifest.sha256,policyHash:policy.hash,circuit,pendingTtlMinutes:ttlMs/60000,drift,initialEquity:walletSensitivity?null:33.59964603,initialWallets,summaries:reports,promotionEligible:false,
 limitations:[independent?'Independent reverse-time validation January-June2023, December2022 warmup; fixed two opening-range hypotheses, no tuning; historical not prospective evidence.':supplemental?'Supplemental reverse-time generalization test July-December2024, June warmup. Not a substitute for prospective evidence or consumed2025 validation.':validation?'VALIDATION of frozen EMA candidate; July-September only, June warmup; reserved test not accessed.':'TRAIN only; no validation/holdout accessed.','15m decision cadence; pending lifecycle sampled every5m and cancel wins same-timestamp races.',
 'Fresh research epoch starts at initial equity; production epoch timestamp/peak override are not copied from2026 into2025.',
 'Minute trade close mark approximates unrealized equity; funding uses archived mark minute open.',
 'No historical AI pending review, dynamic protective trailing/early exits, partial fills, liquidity or full exchange parity; fixed SL/TP +48h cap.',
 stressAdmission?'Research admission reserves at least0.2% round-trip slippage in both cost paths.':'Stress charges extra execution slippage while retaining configured admission-risk estimates.','B library only; A legacy and C prospective AI not evaluated.']};
sourceGuard.verify();
writeFileSync(out+prefix+'source-guard.json',JSON.stringify({verified:true,sources:sourceGuard.initial},null,2)+'\n');
writeFileSync(out+prefix+split+'-portfolio-summary.json',JSON.stringify(report,null,2)+'\n');
writeFileSync(out+prefix+split+'-source-hashes.json',JSON.stringify(Object.fromEntries([__filename,'src/backtest/opportunity-portfolio.ts','src/utils/ai-opportunity.ts','src/config/pending-order-policy.ts'].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')])),null,2)+'\n');

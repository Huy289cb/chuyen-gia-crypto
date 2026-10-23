const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../..'),base=root+'/docs/audits/2026-09-24-live-testbed',out=root+'/docs/audits/2026-09-25-entry-experiments',read=p=>JSON.parse(fs.readFileSync(p));
const original=read(base+'/protocol.json'),protocol=read(out+'/protocol.json');
for(const k of Object.keys(process.env))if(/^(V3_|TRANSITION_|RANGE_|ADAPTIVE_|FUNDING_|CLOSED_|MIN_|MAX_|RISK_|DAILY_|POST_|LOSS_|CONSECUTIVE_|CIRCUIT_|PROFIT_|INVALIDATION_|SIGNAL_GATE_|PENDING_ORDER_)/.test(k))delete process.env[k];Object.assign(process.env,original.policyEnv);
const {replayCoreCandidates}=require('../src/backtest/live-range-execution-replay.ts'),{getRiskPolicy}=require('../src/config/risk-policy.ts'),{getAiOpportunityPolicy}=require('../src/config/ai-opportunity-policy.ts');
const risk=getRiskPolicy(),policy={...getAiOpportunityPolicy(),minRr:0,ttlMs:2700000},circuit={maxDrawdownPercent:risk.maxDrawdownPercent,drawdownEnabled:risk.circuitDrawdownEnabled,expectancyEnabled:risk.circuitExpectancyKillEnabled,expectancyWindow:risk.circuitExpectancyWindow,expectancyMinSumR:risk.circuitExpectancyMinSumR,maxExposurePercentOfEquity:risk.maxExposurePercentOfEquity};
const rulesOnly=process.argv.includes('--rules-only');const market=read(base+'/market.json'),entries=read(out+'/entries.json'),reviews=rulesOnly?[]:read(out+'/reviews.json');if(!rulesOnly&&reviews.length!==entries.length)throw Error('AI reviews incomplete');
const approved=new Set(reviews.filter(r=>r.approved).map(r=>r.id));
const oldApproved=new Set(read(base+'/reviews.json').filter(r=>r.decision==='trade').map(r=>r.id));
const baseline=read(base+'/opportunities.json').map(x=>{const p=x.opportunity;return {variant:'live_baseline',candidate:{id:p.candidate_key,time:x.time,timeframe:'5m',setup:p.candidate_kind,side:p.side,entry:p.entry_price,stopLoss:p.stop_loss,takeProfit:p.take_profit,targetBound:p.take_profit}};});
const rows=[];
for(const [period,start,end]of [['discovery',protocol.start,protocol.split],['validation',protocol.split,protocol.end],['full',protocol.start,protocol.end]]){
 for(const variant of ['live_baseline',...protocol.variants])for(const ai of (rulesOnly?[false]:[false,true]))for(const slip of [.001,.002]){
  const candidates=[...entries,...baseline].filter(e=>e.variant===variant&&(!ai||(variant==='live_baseline'?oldApproved:approved).has(e.candidate.id))).map(e=>e.candidate).filter(c=>c.time>=start&&c.time<end);
  const result=replayCoreCandidates({bars:market.byTf['1m'],funding:market.funding,candidates,start,end,wallet:original.wallet,policy,circuit,slippage:slip,runtimeProfitProtect:'fixed_buffer'});
  const row={period,variant,ai,cost:slip===.001?'base':'stress',...result.summary};rows.push(row);
  fs.writeFileSync(out+`/${period}-${variant}-${ai?'ai':'rules'}-${row.cost}.json`,JSON.stringify(result));
  fs.writeFileSync(out+(rulesOnly?'/rules-summary.json':'/summary.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(row));
 }
}
const ranked=rows.filter(r=>r.period==='discovery'&&r.cost==='stress'&&r.variant!=='live_baseline'&&r.fills>0).sort((a,b)=>b.netUsd-a.netUsd);
const selected=ranked[0]??null,validation=selected?rows.find(r=>r.period==='validation'&&r.cost==='stress'&&r.variant===selected.variant&&r.ai===selected.ai):null;
fs.writeFileSync(out+(rulesOnly?'/rules-selection.json':'/selection.json'),JSON.stringify({selected,validation,deployEligible:false,reason:'Previously observed data; require independent unseen validation, adequate trades and known AI costs even if positive.'},null,2));

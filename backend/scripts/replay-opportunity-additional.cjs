require('dotenv').config({quiet:true});process.env.NODE_ENV='test';
const fs=require('fs'),crypto=require('crypto');
const {replayCoreCandidates}=require('../src/backtest/live-range-execution-replay');
const out='../docs/audits/2026-09-26-opportunity-rr2-ai/';
const read=p=>JSON.parse(fs.readFileSync(p));
const p=read(out+'protocol.json'),cases=read(out+'cases.json'),responses=read(out+'responses.json');
const raw=fs.readFileSync('../docs/audits/2026-09-11-opportunity-testbed/train-data.json');
if(crypto.createHash('sha256').update(raw).digest('hex')!==p.datasetHash)throw Error('data_changed');
const data=JSON.parse(raw),r=p.risk;
const circuit={maxDrawdownPercent:r.maxDrawdownPercent,drawdownEnabled:r.circuitDrawdownEnabled,expectancyEnabled:r.circuitExpectancyKillEnabled,expectancyWindow:r.circuitExpectancyWindow,expectancyMinSumR:r.circuitExpectancyMinSumR,maxExposurePercentOfEquity:r.maxExposurePercentOfEquity};
fs.writeFileSync(out+'additional-protocol.json',JSON.stringify({createdAt:new Date().toISOString(),criterion:'At signal time, RR2 setup/side exists but same setup/side is ineligible at RR3. Rebuild independent chronological portfolio. No outcome-based individual trade selection.',status:'Adaptive development follow-up after positive contribution in main replay; NOT independent validation.',aiCost:'Charge all 82 original model calls; choices are reused and may reject an additional plan when another plan was selected.'},null,2),{flag:'wx'});
const rows=[];
for(const model of ['rules_rr2',...p.models]){
 const answers=responses.filter(x=>x.model===model),cost=answers.reduce((s,x)=>{if(typeof x.usage?.cost!=='number')throw Error('unknown_cost');return s+x.usage.cost;},0);
 const candidates=cases.flatMap(s=>{const answer=answers.find(x=>x.asOf===s.asOf);const selected=model==='rules_rr2'?s.plans.find(x=>!s.baselineSetups.includes(x.setup+':'+x.side)):answer?.choice?.decision==='take'?s.plans.find(x=>x.id===answer.choice.plan_id&&!s.baselineSetups.includes(x.setup+':'+x.side)):null;return selected?[{...selected,time:s.asOf+60000,timeframe:'15m'}]:[];});
 for(const slippage of [.001,.002]){
  const result=replayCoreCandidates({bars:data.byTf['1m'],funding:data.funding,candidates,start:p.start,end:p.end,wallet:p.wallet,policy:{...p.policy,minRr:2},circuit,slippage});
  const tag=slippage===.001?'base':'stress';rows.push({model,cost:tag,...result.summary,aiCost:cost,netAfterAi:result.summary.netUsd-cost,roiAfterAi:(result.summary.netUsd-cost)/p.wallet*100});fs.writeFileSync(out+'additional-'+model.replaceAll('/','__')+'-'+tag+'.json',JSON.stringify(result));
 }
}
fs.writeFileSync(out+'additional-summary.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(rows,null,2));

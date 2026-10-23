require('dotenv').config({quiet:true});process.env.NODE_ENV='test';
const fs=require('fs'),crypto=require('crypto');const {variants}=require('./entry-quality-variants.cjs');
const {replayCoreCandidates}=require('../src/backtest/live-range-execution-replay');
const read=f=>JSON.parse(fs.readFileSync(f)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const input='../docs/audits/2026-09-26-opportunity-rr2-ai/',out='../docs/audits/2026-09-26-entry-quality/';fs.mkdirSync(out,{recursive:true});
const p=read(input+'protocol.json'),cases=read(input+'cases.json'),raw=fs.readFileSync('../docs/audits/2026-09-11-opportunity-testbed/train-data.json');
if(sha(raw)!==p.datasetHash||sha(JSON.stringify(cases))!==p.casesHash)throw Error('input_changed');
const data=JSON.parse(raw),r=p.risk,circuit={maxDrawdownPercent:r.maxDrawdownPercent,drawdownEnabled:r.circuitDrawdownEnabled,expectancyEnabled:r.circuitExpectancyKillEnabled,expectancyWindow:r.circuitExpectancyWindow,expectancyMinSumR:r.circuitExpectancyMinSumR,maxExposurePercentOfEquity:r.maxExposurePercentOfEquity};
const names=['baseline','limit_discount_025r','confirmation','retest_reclaim'];
fs.writeFileSync(out+'protocol.json',JSON.stringify({createdAt:new Date().toISOString(),names,cases:cases.length,dataHash:p.datasetHash,wallet:p.wallet,windowMinutes:30,definition:'Same82 RR2 setup snapshots, first deterministic plan. Original absolute SL/TP remain fixed. Confirmation: first closed5m beyond signal5m high/low, submit original limit. Retest: prior closed5m retraces0.25R, later directional close reclaims original entry, submit original limit. Discount: immediately submit0.25R improved limit. Abort delayed entry if original SL/TP touched. One minute processing delay plus replay resting delay;45min TTL starts at submission.',criteria:'Positive stress ROI and increased fills versus baseline; no live promotion from development-only data.',limits:'Previously observed Jan-Jun2025; no AI; modeled fills; static initial-wallet inventory; original0.8% SL floor may reject improved prices.'},null,2),{flag:'wx'});
const inventory=cases.flatMap(s=>variants(s,data.byTf['5m']));fs.writeFileSync(out+'inventory.json',JSON.stringify(inventory));const rows=[];
for(const kind of names)for(const slippage of [.001,.002]){
 const candidates=inventory.filter(x=>x.kind===kind),result=replayCoreCandidates({bars:data.byTf['1m'],funding:data.funding,candidates,start:p.start,end:p.end,wallet:p.wallet,policy:{...p.policy,minRr:2},circuit,slippage});
 const cost=slippage===.001?'base':'stress';rows.push({kind,cost,...result.summary});fs.writeFileSync(out+kind+'-'+cost+'.json',JSON.stringify(result));
}
fs.writeFileSync(out+'summary.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(rows,null,2));

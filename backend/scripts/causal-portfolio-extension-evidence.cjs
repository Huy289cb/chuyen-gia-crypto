'use strict';
// Evidence-aware version; original frozen extension is preserved.
// Drives actual compiled producer/workflow. No alternate account or PnL engine.
const fs=require('node:fs');
function createCausalPortfolioExtension({runtime,registration,datasetPath,start,end}){
 const data=JSON.parse(fs.readFileSync(datasetPath)),durations={hour:3600000,five:300000,fifteen:900000,fourHour:14400000},tfs={hour:'1h',five:'5m',fifteen:'15m',fourHour:'4h'};
 const series=Object.fromEntries(Object.entries(tfs).map(([key,tf])=>[key,data.byTf[tf].map(b=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}))]));
 const cursors=Object.fromEntries(Object.keys(tfs).map(k=>[k,0]));
 function barsAt(at){const bars={};for(const key of Object.keys(tfs)){
  const all=series[key];while(cursors[key]<all.length&&all[cursors[key]].timestamp+durations[key]+5000<=at)cursors[key]++;
  const limit=key==='hour'?104:key==='fourHour'?cursors[key]:100;bars[key]=all.slice(Math.max(0,cursors[key]-limit),cursors[key]);
 }return bars;}
 const producer=runtime.load('services/causal-opportunity-inventory.service');let state=producer.emptyCausalInventory();
 const events=[],decisions=[],expiries=new Map();
 for(let at=Math.ceil((registration.warmup_start-5000)/300000)*300000+5000;at<start;at+=300000){const next=producer.advanceCausalInventory({state,at,bars:barsAt(at)});state=next.state;}
 async function tick(at){
  const bars=barsAt(at),step=await runtime.step({kind:'causal_inventory',at,input:{state,bars}});state=step.result.state;
  for(const event of step.result.events){events.push(event);if(event.kind!=='resolved'||event.outcome?.status!=='plan'||event.row.candidate.knownAt<start)continue;
   if(registration.arm==='baseline'){decisions.push({setup_id:event.row.candidate.id,at,reason:'baseline_observation_only'});continue;}
   const c=event.row.candidate,p=event.outcome,tf=event.row.mechanism==='H1'?'15m':'5m';
   // Exchange tick0.1 from the frozen exchange model: widen SL, never extend target.
   const stop=c.side==='long'?Math.floor(p.stop*10)/10:Math.ceil(p.stop*10)/10;
   const contract=runtime.load('utils/causal-plan-contract').sealCausalPlan({version:'h1-h2-review-v1',setupId:c.id,mechanism:event.row.mechanism,symbol:'BTC',timeframe:tf,side:c.side,knownAt:c.knownAt,expiresAt:c.expiresAt,entry:p.entry,stop,target:p.target,invalidation:p.invalidation,minRr:1.5});
   const scan=runtime.load('schedulers/market-scan.scheduler').getScanResult('BTC',tf);
   const result=await runtime.step({kind:'causal_review',at,input:{symbol:'BTC',timeframe:tf,causalPlan:contract,causalEvidence:{at,bars},candles:series[tf==='15m'?'fifteen':'five'].slice(Math.max(0,cursors[tf==='15m'?'fifteen':'five']-120),cursors[tf==='15m'?'fifteen':'five']),
    systemPrompt:runtime.load('config/methods').getMethodConfig('kim_nghia').systemPrompt,signalResult:scan?.signalResult}});
   decisions.push({setup_id:c.id,at,result:result.result});
   if(result.result.execution?.success)expiries.set(result.result.execution.orderId,c.expiresAt);
  }
 }
 async function expire(at,database){for(const [orderId,expiresAt]of expiries){if(at<expiresAt)continue;
  const order=await database.testnetPendingOrder.findUnique({where:{order_id:orderId}});
  if(order?.status==='pending')await runtime.step({kind:'cancel',at,orderId,reason:'causal_setup_expired'});
  expiries.delete(orderId);
 }}
 function snapshot(){return {arm:registration.arm,state,events,decisions,pending_expiries:[...expiries],window_end:end};}
 return {tick,expire,snapshot};
}
module.exports={createCausalPortfolioExtension};

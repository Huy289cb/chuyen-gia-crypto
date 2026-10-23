// Descriptive price-path measurement only. No hypothetical fills, sizing, PnL or orders.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function describe(plan,bars,minutes){
 const start=Math.ceil(plan.time/60000)*60000,end=start+minutes*60000;
 const window=bars.filter(b=>b.openTime>=start&&b.openTime<end);
 if(window.length!==minutes||!window.every((b,i)=>b.openTime===start+i*60000))return {status:'unknown',reason:'minute_gap',bars:window.length,expected:minutes};
 const d=plan.side==='long'?1:-1,risk=Math.abs(plan.entry-plan.stop);
 if(!(risk>0&&d*(plan.entry-plan.stop)>0&&d*(plan.target-plan.entry)>0))return {status:'unknown',reason:'invalid_geometry'};
 let stopAt=null,targetAt=null,entryTouchAt=null,mfe=0,mae=0,mfeBeforeStop=0;
 for(const b of window){
  if(![b.open,b.high,b.low,b.close].every(n=>Number.isFinite(n)&&n>0)||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close))return {status:'unknown',reason:'invalid_bar'};
  const favorable=d*((d===1?b.high:b.low)-plan.entry)/risk;
  const adverse=-d*((d===1?b.low:b.high)-plan.entry)/risk;
  mfe=Math.max(mfe,favorable);mae=Math.max(mae,adverse);
  if(entryTouchAt===null&&b.low<=plan.entry&&b.high>=plan.entry)entryTouchAt=b.openTime;
  if(stopAt===null&&(d===1?b.low<=plan.stop:b.high>=plan.stop))stopAt=b.openTime;
  // Exclude stop minute: intrabar order is unknown.
  if(stopAt===null)mfeBeforeStop=Math.max(mfeBeforeStop,favorable);
  if(targetAt===null&&(d===1?b.high>=plan.target:b.low<=plan.target))targetAt=b.openTime;
 }
 const first=stopAt===null?(targetAt===null?'neither':'target'):targetAt===null?'stop':stopAt===targetAt?'ambiguous':stopAt<targetAt?'stop':'target';
 return {status:'observed',minutes,start,end,mfeR:mfe,maeR:mae,mfeBeforeStopFullMinutesR:mfeBeforeStop,
  stopAt,targetAt,entryTouchAt,firstBarrier:first,directionalCloseR:d*(window.at(-1).close-plan.entry)/risk,
  executableFill:'unknown',netExpectancy:'unknown',partialSignalMinuteExcluded:true};
}
module.exports={describe};
if(require.main===module){
 const [exportFile,journalFile,cache,out]=process.argv.slice(2);if(!out)throw Error('Usage: EXPORT JOURNAL CANDLE_CACHE NEW_REPORT');
 const raw=fs.readFileSync(exportFile),journalRaw=fs.readFileSync(journalFile),data=JSON.parse(raw),journal=JSON.parse(journalRaw);
 const sha=b=>crypto.createHash('sha256').update(b).digest('hex');const files=new Map(),rows=[];
 for(const attempt of journal.attempts){
  if(attempt.planAttribution.outcome==='not_observed')continue;
  const e=data.events.find(e=>e.id===attempt.planAttribution.planEventIds[0]);const p=e.event_data;
  const entry=Number(p.entry),stop=Number(p.stop_loss),target=Number(p.take_profit);
  const plan={entry,stop,target,time:Date.parse(e.timestamp),side:stop<entry?'long':'short'};
  const start=Math.ceil(plan.time/60000)*60000,bars=[];
  for(let day=Math.floor(start/86400000)*86400000;day<start+240*60000;day+=86400000){
   const file=path.join(cache,day+'.json');if(!fs.existsSync(file))continue;
   if(!files.has(file)){const bytes=fs.readFileSync(file);files.set(file,{sha256:sha(bytes),bars:JSON.parse(bytes)});}
   bars.push(...files.get(file).bars);
  }
  rows.push({traceId:attempt.traceId,eventId:e.id,codeHashes:attempt.codeHashes,policyHashes:attempt.policyHashes,
   candidateKey:attempt.candidateKey,group:attempt.planAttribution.outcome,plan,
   horizons:[60,240].map(m=>describe(plan,bars,m))});
 }
 const groups={};for(const row of rows){const key=JSON.stringify([row.codeHashes,row.group,row.plan.side]);
  if(!groups[key])groups[key]={attempts:0,hour4:{}};groups[key].attempts++;
  const h=row.horizons[1],label=h.status==='observed'?h.firstBarrier:'unknown';groups[key].hour4[label]=(groups[key].hour4[label]||0)+1;
 }
 const result={schema:'plan-path-diagnosis-v1',sourceSha256:sha(raw),journalSha256:sha(journalRaw),scriptSha256:sha(fs.readFileSync(__filename)),
  candles:Object.fromEntries([...files].map(([f,v])=>[f,v.sha256])),rows,groups,
  limits:['Historical development, not current model evaluation or holdout.','AI geometry before repair; direction inferred from stop geometry.','Trade-price minute barriers, not mark stops or executable fills.','Repeated attempts are not independent setups; no ROI or counterfactual profit claim.','No account state, costs, latency, queue or strategy selection modeled.']};
 fs.writeFileSync(out,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({rows:rows.length,groups},null,2));
}

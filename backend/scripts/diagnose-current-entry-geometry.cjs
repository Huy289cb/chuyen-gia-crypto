// Descriptive current-version stage audit; never treats a proxy or rejected plan as a fill.
const fs=require('node:fs'),crypto=require('node:crypto');
const [source,out]=process.argv.slice(2);if(!source||!out||fs.existsSync(out))throw Error('new_output_required');
const bytes=fs.readFileSync(source),data=JSON.parse(bytes),traces=new Map();
for(const e of data.events){const d=e.event_data;if(!d.trace_id)continue;
 const rows=traces.get(d.trace_id)??[];rows.push(e);traces.set(d.trace_id,rows);}
const rows=[];
for(const [traceId,events]of traces){
 const pre=events.find(e=>e.event_data.stage==='feasibility_before_ai');if(!pre)continue;
 const d=pre.event_data,m=d.measurement;
 const plans=events.filter(e=>e.event_data.stage==='plan_geometry').map(e=>{
  const p=e.event_data,entry=Number(p.entry),sl=Number(p.stop_loss),tp=Number(p.take_profit);
  const valid=[entry,sl,tp].every(v=>Number.isFinite(v)&&v>0),floor=Number(m?.minSlFraction);
  return {eventId:e.id,source:p.source,entry,sl,tp,
   stopFraction:valid?Math.abs(entry-sl)/entry:null,
   targetFraction:valid?Math.abs(tp-entry)/entry:null,
   rewardOverMinimumStop:valid&&floor>0?Math.abs(tp-entry)/(entry*floor):null};
 });
 rows.push({traceId,observedAt:pre.timestamp,codeHash:d.code_hash,policyHash:d.policy_hash,
  candidateKey:d.candidate_key??null,observationKey:d.observation_key??null,
  measurement:m??null,plans,
  terminalReasons:events.filter(e=>e.event_data.stage==='dispatch_result').map(e=>e.event_data.reason)});
}
const r={sourceSha256:crypto.createHash('sha256').update(bytes).digest('hex'),since:data.since,through:data.through,
 rows,orders:data.orders.length,positions:data.positions.length,
 limits:['Trace counts are attempts, not independent opportunities.','Target bounds are diagnostic observed structure, not guaranteed barriers.',
 'No fill/ROI inference from geometry; costs remain unmeasured in this audit.','No prompt or risk configuration changed.']};
fs.writeFileSync(out,JSON.stringify(r,null,2),{flag:'wx'});console.log(JSON.stringify({attempts:rows.length,orders:r.orders,positions:r.positions}));

// Recorded component replay; no strategy simulation or account mutation.
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');require('tsx/cjs');
const {replayRecordedPostQuantity}=require('../src/utils/recorded-post-quantity.ts');
const [input,out]=process.argv.slice(2);if(!out)throw Error('Usage: EXPORT NEW_REPORT');
const bytes=fs.readFileSync(input),source=JSON.parse(bytes);if(!Array.isArray(source.events))throw Error('missing_events');
const rows=source.events.filter(e=>e.event_type==='entry_trace'&&['risk_checked','post_quantity_evaluated'].includes(e.event_data?.stage)).map(e=>{
 const result=replayRecordedPostQuantity(e.event_data.input??{});let parity='unknown';
 if(result.status==='evaluated'){try{assert.deepStrictEqual(result.decision,e.event_data.decision);parity='match';}catch{parity='mismatch';}}
 return {event_id:e.id,trace_id:e.event_data.trace_id??null,result,parity};
});
const report={schema:'recorded-post-quantity-replay-v1',input_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),rows,
 limits:'Component decision only. risk_checked legacy rows lack required recorded inputs; never reconstructed from defaults. Not execution/lifecycle/portfolio parity or ROI.'};
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({rows:rows.length,parityCounts:rows.reduce((a,r)=>(a[r.parity]=(a[r.parity]??0)+1,a),{})}));

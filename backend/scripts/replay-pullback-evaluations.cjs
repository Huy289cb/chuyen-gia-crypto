// Audit replay only: uses recorded inputs, never reconstructs old decisions with current prices.
const fs=require('node:fs'),crypto=require('node:crypto');
const {evaluateRecordedPullback}=require('../src/utils/pullback-evaluation');
const [source,out]=process.argv.slice(2);
if(!source||!out)throw Error('Usage: node -r tsx/cjs scripts/replay-pullback-evaluations.cjs EXPORT NEW_REPORT');
const bytes=fs.readFileSync(source),data=JSON.parse(bytes),rows=[];
for(const e of data.events||[]){
 if(e.event_type!=='entry_trace'||!['pullback_evaluated','pullback_unavailable'].includes(e.event_data?.stage))continue;
 const recorded=e.event_data.evaluation;
 let status='unknown';
 if(recorded?.schema==='pullback-evaluation-v1'){
  try {
   const replay=evaluateRecordedPullback(recorded.input);
   status=JSON.stringify(replay)===JSON.stringify(recorded)?'matched':'mismatch';
  }catch{status='invalid_record';}
 }
 rows.push({eventId:e.id,traceId:e.event_data.trace_id,status});
}
const report={schema:'pullback-audit-replay-v1',sourceSha256:crypto.createHash('sha256').update(bytes).digest('hex'),
 rows,coverage:rows.length?'recorded pullback events only':'unknown: no recorded pullback inputs',
 gateP:'not_passed: component audit does not establish whole execution parity'};
fs.writeFileSync(out,JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({rows:rows.length,coverage:report.coverage}));
if(rows.some(r=>r.status==='mismatch'||r.status==='invalid_record'))process.exitCode=2;

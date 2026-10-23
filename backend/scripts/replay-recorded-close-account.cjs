const fs=require('node:fs'),crypto=require('node:crypto');require('tsx/cjs');
const {replayRecordedCloseAccount:replay}=require('../src/utils/recorded-close-account.ts');
const [input,cutoff,out]=process.argv.slice(2);if(!out||fs.existsSync(out))throw Error('Usage: EXPORT ISO_CUTOFF NEW_REPORT');
const asOf=Date.parse(cutoff);if(!Number.isFinite(asOf))throw Error('invalid_cutoff');
const bytes=fs.readFileSync(input),source=JSON.parse(bytes);if(!Array.isArray(source.events))throw Error('missing_events');
let excludedFuture=0;const eligible=source.events.filter(e=>{if(e.event_type!=='close_account_update_applied')return false;const known=Date.parse(e.timestamp);if(Number.isFinite(known)&&known>asOf){excludedFuture++;return false;}return true;});
const counts=new Map();for(const e of eligible)counts.set(String(e.id),(counts.get(String(e.id))??0)+1);
const rows=eligible.map(e=>({event_id:e.id,position_id:typeof e.position_id==='string'&&e.position_id?e.position_id:null,
 result:e.id==null||e.id===''?{status:'unknown',reason:'missing_event_id'}:counts.get(String(e.id))!==1?{status:'unknown',reason:'duplicate_event_id'}:replay(e.event_data,Date.parse(e.timestamp),asOf)}));
const report={schema:'recorded-close-account-replay-v1',input_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),as_of:cutoff,rows,excludedFuture,
 matched:rows.filter(r=>r.result.status==='evaluated'&&r.result.matches_recorded).length,mismatches:rows.filter(r=>r.result.status==='mismatch'||r.result.status==='evaluated'&&!r.result.matches_recorded).length,
 unknown:rows.filter(r=>r.result.status==='unknown').length,limits:'Recorded local account update only; no exchange-round, fee/funding/provider cost, serializable ledger or wallet sync inference.'};
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({matched:report.matched,mismatches:report.mismatches,unknown:report.unknown,excludedFuture}));

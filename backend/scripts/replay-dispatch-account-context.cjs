const fs=require('fs'),crypto=require('crypto');require('tsx/cjs');
const {replayAccountOverwriteTimeline}=require('../src/utils/recorded-account-timeline.ts');
const [input,out,seedFile]=process.argv.slice(2);if(!input||!out||fs.existsSync(out))throw Error('EXPORT NEW_REPORT [FORWARD_SEED]');
const bytes=fs.readFileSync(input),exported=JSON.parse(bytes),seed=seedFile?JSON.parse(fs.readFileSync(seedFile)):undefined;
if(!Array.isArray(exported.events)||!Number.isFinite(Date.parse(exported.through)))throw Error('invalid_export');
const rows=exported.events.filter(e=>e.event_type==='entry_trace'&&e.event_data.stage==='dispatch_started').map(e=>{
 const cutoff=Date.parse(e.event_data.evaluated_at),known=Date.parse(e.timestamp);
 if(!Number.isFinite(cutoff)||!Number.isFinite(known)||cutoff>known||known>Date.parse(exported.through))return {event_id:e.id,status:'unknown',reason:'invalid_dispatch_clock'};
 const prefix=exported.events.filter(row=>Number.isFinite(Date.parse(row.timestamp))&&Date.parse(row.timestamp)<=cutoff);
 const replay=replayAccountOverwriteTimeline(prefix,cutoff,seed);
 return {event_id:e.id,trace_id:e.event_data.trace_id,dispatch_started_at:new Date(cutoff).toISOString(),journal_known_at:e.timestamp,known_prefix_events:prefix.length,initial_state:replay.initial_state,accounts:replay.accounts.map(a=>({account_id:a.account_id,status:a.status,reason:a.reason,seed_applied:a.seed_applied,observed_field_convergence:a.observed_field_convergence,current_account_state:a.current_account_state})),actual_guard_read_state:'not_established'};
});
fs.writeFileSync(out,JSON.stringify({schema:'dispatch-account-context-v1',input_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),rows,whole_engine_parity:'not_established',economic_roi:null,limits:'Observed writes known at dispatch start only. Dispatch clock is not an actual account guard read/commit clock. No future terminal fields or retroactive snapshot seed.'},null,2),{flag:'wx',mode:0o600});console.log({dispatches:rows.length,actualReadState:'not_established'});

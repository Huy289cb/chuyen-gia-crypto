// SELECT-only telemetry checkpoint, explicit since; never export provider prompts/responses.
require('dotenv').config({quiet:true});
const fs=require('node:fs'),crypto=require('node:crypto'),{prisma}=require('../dist/lib/prisma');
const [sinceArg,out,throughArg]=process.argv.slice(2),since=new Date(sinceArg);
if(!out||!Number.isFinite(+since)||fs.existsSync(out))throw Error('Usage: ISO_SINCE NEW_EXPORT');
(async()=>{
 const result=await prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const [clock]=await tx.$queryRawUnsafe('SELECT CURRENT_TIMESTAMP AS cutoff');
  const transaction_started_at=new Date(clock.cutoff);const through=throughArg?new Date(throughArg):transaction_started_at;if(!Number.isFinite(+through)||through>transaction_started_at)throw Error('future_or_invalid_cutoff');if(since>through)throw Error('future_since');
  const rows=await tx.testnetTradeEvent.findMany({where:{event_type:{in:['atomic_verified_close_committed','position_reduction_write_observed','position_close_write_observed','materialization_gate_evaluated','materialization_write_observed','pending_order_linked','entry_order_filled','position_closed','entry_trace','gate_funnel_shadow','pending_cancel_ack','pending_cancel_db_claim','pending_order_cancelled','partial_fill_requery','protective_action_evaluated','protective_order_acknowledged','close_account_update_applied','close_round_query_observed','wallet_sync_observed','account_wallet_sync_observed','account_wallet_reconcile_applied','account_net_statistics_applied','account_guard_mutation_applied','account_cooldown_set_applied','account_circuit_mutation_applied','account_precision_reset_applied','account_starting_balance_sync_applied','account_backfill_statistics_applied','account_manual_close_applied']},timestamp:{gte:since,lte:through}},orderBy:{id:'asc'},take:20000,select:{id:true,position_id:true,timestamp:true,event_type:true,event_data:true}});
  if(rows.length===20000)throw Error('export_truncated');
  const events=rows.map(row=>({...row,event_data:typeof row.event_data==='string'?JSON.parse(row.event_data):row.event_data}));
  const [observed]=await tx.$queryRawUnsafe('SELECT clock_timestamp() AS cutoff');const snapshot_observed_at=new Date(observed.cutoff);
  return {schema:'upgrade-telemetry-export-v2',since:since.toISOString(),through:through.toISOString(),snapshot_observed_at:snapshot_observed_at.toISOString(),availability_basis:'visible_at_collection_snapshot_not_commit_visibility_at_event_cutoff',events,source:'SELECT-only repeatable-read telemetry checkpoint; provider events excluded'};
 },{isolationLevel:'RepeatableRead'});
 result.collector_sha256=crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 const stages={};for(const e of result.events){const key=e.event_data.stage??e.event_type;stages[key]=(stages[key]??0)+1;}
 console.log(JSON.stringify({events:result.events.length,stages,through:result.through}));
})().catch(e=>{console.error('telemetry_capture_failed:'+e.constructor.name);process.exitCode=1;}).finally(()=>prisma.$disconnect());

import {buildAccountResetUpdate} from './account-reset-update';
const obj=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const clock=(v:unknown)=>typeof v==='string'?Date.parse(v):NaN;
/** SELECT-observed committed row; insertion timestamp never establishes commit ordering. */
export function replayRecordedAccountReset(row:unknown,knownAt:number,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(![knownAt,asOf].every(Number.isFinite)||knownAt>asOf)return unknown('invalid_knowledge_cutoff');
 const r=obj(row),d=obj(r?.evidence),input=obj(d?.input),update=obj(d?.update);
 if(!r||!d||!input||!update||d.schema!=='account-reset-receipt-v1'||!Number.isSafeInteger(d.account_id)||Number(d.account_id)<=0||r.account_id!==d.account_id||r.attempt_id!==d.reset_attempt_id||typeof d.reset_attempt_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(d.reset_attempt_id)||r.mutation_kind!=='admin_local_reset'||d.mutation_kind!==r.mutation_kind||!Number.isFinite(input.starting_balance)||d.clock_basis!=='transaction_insert_not_commit'||d.exchange_flatness_verified!==false||d.economic_initial_capital!==null)return unknown('invalid_reset_receipt');
 const start=clock(d.write_started_at),updated=clock(update.updated_at),inserted=clock(r.recorded_at);
 if(![start,updated,inserted].every(Number.isFinite)||updated!==start||start>knownAt||inserted>knownAt)return unknown('invalid_receipt_clocks');
 const scope=['pending_orders','position_trade_events','positions','account_snapshots'];
 const deletedHistory=d.deleted_local_history;
 if(!Array.isArray(deletedHistory)||deletedHistory.length!==scope.length||!scope.every((v,i)=>deletedHistory[i]===v))return unknown('invalid_reset_scope');
 const expected=JSON.parse(JSON.stringify(buildAccountResetUpdate(Number(input.starting_balance),new Date(start)))) as Record<string,unknown>;
 return {status:'evaluated' as const,account_id:d.account_id,expected_update:expected,matches_recorded:Object.keys(update).length===Object.keys(expected).length&&Object.entries(expected).every(([k,v])=>update[k]===v),commit_time:null,commit_order:'not_established' as const,economic_total_pnl:null,current_account_state:null};
}

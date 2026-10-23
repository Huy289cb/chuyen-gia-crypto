import {buildManualCloseAccountUpdate} from './manual-close-account-update';
const obj=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const clock=(v:unknown)=>typeof v==='string'?Date.parse(v):NaN;
export function replayRecordedManualClose(record:unknown,knownAt:number,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(![knownAt,asOf].every(Number.isFinite)||knownAt>asOf)return unknown('invalid_knowledge_cutoff');
 const d=obj(record),i=obj(d?.input),update=obj(d?.update);
 if(d?.schema!=='account-manual-close-v1'||!Number.isSafeInteger(d.account_id)||Number(d.account_id)<=0||!i||!update||typeof d.position_id!=='string'||!d.position_id||typeof d.manual_close_attempt_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(d.manual_close_attempt_id)||!Number.isFinite(i.balance)||!Number.isFinite(i.realized_pnl)||d.pnl_basis!=='local_mark_price'||d.exchange_close_verified!==false)return unknown('invalid_manual_close_input');
 const start=clock(d.write_started_at),applied=clock(d.applied_at),updated=clock(update.updated_at),trade=clock(update.last_trade_time);
 if(![start,applied,updated,trade].every(Number.isFinite)||updated!==start||trade>start||start>applied||applied>knownAt||d.applied_clock_source!=='db_update_return')return unknown('invalid_write_clocks');
 const expected=JSON.parse(JSON.stringify(buildManualCloseAccountUpdate({balance:Number(i.balance),realizedPnl:Number(i.realized_pnl),lastTradeTime:new Date(trade),updatedAt:new Date(updated)}))) as Record<string,unknown>;
 if(!Number.isFinite(expected.current_balance))return unknown('nonfinite_derived_update');
 const matches=Object.keys(update).length===Object.keys(expected).length&&Object.entries(expected).every(([k,v])=>{
  if(v&&typeof v==='object'){const actual=obj(update[k]);return actual!==null&&Object.keys(actual).length===1&&actual.increment===(v as {increment:number}).increment;}
  return update[k]===v;
 });
 return {status:'evaluated' as const,account_id:d.account_id,expected_update:expected,matches_recorded:matches,exchange_close_verification:'not_established' as const,economic_total_pnl:null};
}

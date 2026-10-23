import {buildBackfillAccountStatistics} from './backfill-account-statistics';
const obj=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const clock=(v:unknown)=>typeof v==='string'?Date.parse(v):NaN;
export function replayRecordedBackfillStatistics(record:unknown,knownAt:number,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(![knownAt,asOf].every(Number.isFinite)||knownAt>asOf)return unknown('invalid_knowledge_cutoff');
 const d=obj(record),i=obj(d?.input),update=obj(d?.update);
 if(d?.schema!=='account-backfill-statistics-v2'||!Number.isSafeInteger(d.account_id)||Number(d.account_id)<=0||!i||!Array.isArray(i.positions)||!update||typeof d.backfill_attempt_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(d.backfill_attempt_id))return unknown('invalid_backfill_input');
 const start=clock(d.write_started_at),applied=clock(d.applied_at),updated=clock(update.updated_at);
 if(![start,applied,updated].every(Number.isFinite)||updated!==start||start>applied||applied>knownAt||d.applied_clock_source!=='db_update_return')return unknown('invalid_write_clocks');
 const ids=new Set<string>(),rows:{realized_pnl:number|null;close_reason:string|null}[]=[];
 for(const value of i.positions){const p=obj(value);
  if(!p||typeof p.position_id!=='string'||!p.position_id||ids.has(p.position_id)||!(p.close_reason===null||typeof p.close_reason==='string')||!((p.pnl_status==='null'&&p.realized_pnl===null)||(p.pnl_status==='finite'&&Number.isFinite(p.realized_pnl))))return unknown('invalid_or_nonfinite_position_input');
  ids.add(p.position_id);rows.push(p as unknown as {realized_pnl:number|null;close_reason:string|null});
 }
 const result=buildBackfillAccountStatistics(rows);
 let expected:Record<string,unknown>;
 if(d.kind==='trade_statistics_overwrite')expected={...result.statistics,updated_at:update.updated_at};
 else if(d.kind==='paper_realized_overwrite'&&i.binance_enabled===false&&Number.isFinite(result.totalRealized))expected={realized_pnl:result.totalRealized,updated_at:update.updated_at};
 else return unknown('unsupported_backfill_write');
 return {status:'evaluated' as const,account_id:d.account_id,expected_update:expected,matches_recorded:Object.keys(update).length===Object.keys(expected).length&&Object.entries(expected).every(([k,v])=>update[k]===v),exchange_history_completeness:'not_established' as const,economic_total_pnl:null};
}

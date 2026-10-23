import {buildPrecisionResetUpdate} from './precision-reset-update';
const obj=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const clock=(v:unknown)=>typeof v==='string'?Date.parse(v):NaN;
export function replayRecordedPrecisionReset(record:unknown,knownAt:number,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(![knownAt,asOf].every(Number.isFinite)||knownAt>asOf)return unknown('invalid_knowledge_cutoff');
 const d=obj(record),i=obj(d?.input),update=obj(d?.update);
 if(d?.schema!=='account-precision-reset-v1'||!Number.isSafeInteger(d.account_id)||Number(d.account_id)<=0||!i||!update||typeof d.precision_attempt_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(d.precision_attempt_id))return unknown('invalid_reset_input');
 const selected=clock(i.updated_at),start=clock(d.write_started_at),applied=clock(d.applied_at);
 if(![selected,start,applied].every(Number.isFinite)||selected>start||start>applied||applied>knownAt||d.applied_clock_source!=='db_update_return')return unknown('invalid_write_clocks');
 const expected={...buildPrecisionResetUpdate(new Date(selected)),updated_at:new Date(selected).toISOString()};
 return {status:'evaluated' as const,account_id:d.account_id,expected_update:expected,matches_recorded:Object.keys(update).length===Object.keys(expected).length&&Object.entries(expected).every(([k,v])=>update[k]===v),caller_authorization:'not_established' as const,economic_total_pnl:null};
}

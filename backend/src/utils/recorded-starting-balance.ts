import {buildStartingBalanceUpdate} from './starting-balance-update';
const obj=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const clock=(v:unknown)=>typeof v==='string'?Date.parse(v):NaN;
export function replayRecordedStartingBalance(record:unknown,knownAt:number,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(![knownAt,asOf].every(Number.isFinite)||knownAt>asOf)return unknown('invalid_knowledge_cutoff');
 const d=obj(record),i=obj(d?.input),update=obj(d?.update);
 if(d?.schema!=='account-starting-balance-sync-v1'||!Number.isSafeInteger(d.account_id)||Number(d.account_id)<=0||!i||!update||typeof d.capital_attempt_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(d.capital_attempt_id)||i.total_trades!==0||!Number.isFinite(i.wallet_balance)||!(i.previous_starting_balance===null||Number.isFinite(i.previous_starting_balance)))return unknown('invalid_capital_field_input');
 const start=clock(d.write_started_at),applied=clock(d.applied_at);
 if(![start,applied].every(Number.isFinite)||start>applied||applied>knownAt||d.applied_clock_source!=='db_update_return')return unknown('invalid_write_clocks');
 const expected=buildStartingBalanceUpdate(Number(i.wallet_balance));
 return {status:'evaluated' as const,account_id:d.account_id,expected_update:expected,matches_recorded:Object.keys(update).length===1&&update.starting_balance===expected.starting_balance,economic_initial_capital:null,transfer_verification:'not_established' as const,economic_total_pnl:null};
}

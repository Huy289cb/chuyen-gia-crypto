import {calcDrawdownPercent} from './account-drawdown-percent';
const obj=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const clock=(v:unknown)=>typeof v==='string'?Date.parse(v):NaN;
export function replayRecordedAccountCircuitMutation(record:unknown,knownAt:number,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(![knownAt,asOf].every(Number.isFinite)||knownAt>asOf)return unknown('invalid_knowledge_cutoff');
 const d=obj(record),i=obj(d?.input),update=obj(d?.update);
 if(d?.schema!=='account-circuit-mutation-v1'||!Number.isSafeInteger(d.account_id)||Number(d.account_id)<=0||!i||!update||typeof d.circuit_attempt_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(d.circuit_attempt_id))return unknown('invalid_mutation_input');
 const start=clock(d.write_started_at),applied=clock(d.applied_at);
 if(![start,applied].every(Number.isFinite)||start>applied||applied>knownAt||d.applied_clock_source!=='db_update_return')return unknown('invalid_write_clocks');
 let expected:Record<string,unknown>;
 if(d.kind==='max_drawdown_overwrite'){
  if(![i.equity,i.peak_equity,i.drawdown_percent].every(Number.isFinite)||!(i.previous_max_drawdown===null||Number.isFinite(i.previous_max_drawdown))||!['override','override_ratcheted','strategy_epoch_snapshots','full_history_snapshots'].includes(String(i.peak_equity_source)))return unknown('invalid_drawdown_input');
  const drawdown=calcDrawdownPercent(Number(i.peak_equity),Number(i.equity));
  if(!Number.isFinite(drawdown)||drawdown!==i.drawdown_percent||!(drawdown>Number(i.previous_max_drawdown??0)))return unknown('drawdown_write_not_supported');
  expected={max_drawdown:drawdown};
 }else if(d.kind==='expectancy_cooldown_overwrite'){
  const selected=clock(i.selected_at),until=clock(i.selected_until),previous=clock(i.previous_cooldown_until);
  if(i.allowed!==false||typeof i.reason!=='string'||!i.reason.startsWith('Expectancy kill:')||!Number.isFinite(i.cooldown_hours)||!(Number(i.cooldown_hours)>0)||![selected,until].every(Number.isFinite)||selected>start||until!==selected+Number(i.cooldown_hours)*3600000)return unknown('invalid_cooldown_input');
  if(i.previous_cooldown_status==='valid'){if(!Number.isFinite(previous)||previous>until)return unknown('sticky_cooldown_not_supported');}
  else if(i.previous_cooldown_status!=='absent'||i.previous_cooldown_until!==null)return unknown('previous_cooldown_unknown');
  expected={cooldown_until:i.selected_until};
 }else return unknown('unsupported_mutation_kind');
 return {status:'evaluated' as const,account_id:d.account_id,expected_update:expected,matches_recorded:Object.keys(update).length===Object.keys(expected).length&&Object.entries(expected).every(([k,v])=>update[k]===v),query_completeness:'not_established' as const,economic_total_pnl:null};
}

import {replayRecordedMaterializationGate} from './recorded-materialization-gate';
import {replayRecordedMaterializationWrite} from './recorded-materialization-write';
export interface MaterializationEvent {id:string|number;event_type:string;event_data:Record<string,any>}
/** Scoped local deltas from an explicit producer attempt; never complete portfolio/exchange state. */
export function composeMaterializationAttempts(events:MaterializationEvent[],asOf:number){
 const groups=new Map<string,MaterializationEvent[]>(),unlinked:(string|number)[]=[];
 for(const e of events){if(!['materialization_gate_evaluated','materialization_write_observed'].includes(e.event_type))continue;const id=e.event_data.materialization_attempt_id;if(typeof id!=='string'||!id){unlinked.push(e.id);continue;}if(!groups.has(id))groups.set(id,[]);groups.get(id)!.push(e);}
 const attempts=[...groups].map(([id,rows])=>{const unknown=(reason:string)=>({materialization_attempt_id:id,status:'unknown' as const,reason,created_position:null,pending_update:null});
 const first=rows[0].event_data;if(rows.some(e=>e.event_data.order_id!==first.order_id||e.event_data.account_id!==first.account_id))return unknown('attempt_identity_conflict');
 const select=(type:string,key:string,value:string)=>rows.filter(e=>e.event_type===type&&e.event_data[key]===value);
 const prices=select('materialization_gate_evaluated','stage','price'),exposures=select('materialization_gate_evaluated','stage','exposure_quantity'),creates=select('materialization_write_observed','kind','create_position'),executes=select('materialization_write_observed','kind','execute_pending');
 if([prices,exposures,creates,executes].some(x=>x.length>1))return unknown('duplicate_stage_or_write');
 if(creates.length!==1||prices.length!==1||exposures.length!==1)return unknown('missing_new_position_evidence');
 const p=prices[0].event_data,x=exposures[0].event_data,c=creates[0].event_data,pr=replayRecordedMaterializationGate(p,asOf),xr=replayRecordedMaterializationGate(x,asOf),cr=replayRecordedMaterializationWrite(c,asOf);
 if(pr.status!=='evaluated'||!pr.matches_recorded||!pr.expected_decision.allowed||xr.status!=='evaluated'||!xr.matches_recorded||!xr.expected_decision.allowed||cr.status!=='write_contract_replayed'||cr.kind!=='create_position')return unknown('gate_or_create_unknown_or_mismatch');
 if(p.input.avg_price.value!==cr.input.entryPrice||!('quantity' in xr.expected_decision)||xr.expected_decision.quantity!==cr.input.sizeQty)return unknown('gate_create_financial_conflict');
 const t=(s:string)=>Date.parse(s);if(t(p.observed_at)>t(x.input.read_started_at)||t(x.observed_at)>t(c.write_started_at))return unknown('gate_write_clock_conflict');
 let pending_update:null|{order_id:string;status:string}=null,pending_reason='missing_execute_receipt';
 if(executes.length){const e=executes[0].event_data,er=replayRecordedMaterializationWrite(e,asOf);if(e.position_id!==c.position_id||t(c.write_returned_at)>t(e.write_started_at))return unknown('create_execute_identity_or_clock_conflict');if(er.status==='write_contract_replayed'&&er.kind==='execute_pending'){pending_update={order_id:er.order_id,status:er.pending_status};pending_reason='returned_contract';}else pending_reason='failed_or_unverified_execute';}
 return {materialization_attempt_id:id,status:'observed_local_delta' as const,created_position:{position_id:cr.position_id,account_id:cr.account_id,input:cr.input},pending_update,pending_reason,current_position:'not_established' as const,active_protection:'not_established' as const,exchange_fill:'not_established' as const};
 });
 const created=attempts.filter(a=>a.status==='observed_local_delta').map(a=>a.created_position!.position_id);const conflicts=created.filter((id,i)=>created.indexOf(id)!==i);
 return {attempts:attempts.map(a=>a.status==='observed_local_delta'&&conflicts.includes(a.created_position!.position_id)?{materialization_attempt_id:a.materialization_attempt_id,status:'unknown',reason:'repeated_position_creation',created_position:null,pending_update:null}:a),unlinked,full_state:'not_established' as const};
}

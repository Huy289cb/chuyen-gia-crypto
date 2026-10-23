import {composeMaterializationAttempts} from './materialization-attempt-composition';
import {replayRecordedMaterializationGate} from './recorded-materialization-gate';
import {replayRecordedMaterializationWrite} from './recorded-materialization-write';
import {replayRecordedProtectiveAction} from './recorded-protective-action';
import {replayRecordedProtectiveAcknowledgement} from './recorded-protective-ack';
import {replayRecordedCancelAck,replayRecordedCancelClaim} from './pending-cancel-transition';
import {replayRecordedPartialRequery} from './partial-fill-evidence';
export interface LifecycleEvent{id:number|string;event_type:string;event_data:Record<string,unknown>}
/** Observed terminal updates only; no synthetic initial occupancy or position materialization. */
export function replayPortfolioLifecycleEvidence(events:LifecycleEvent[],asOf:number){
 const attempts=new Map<string,LifecycleEvent[]>(),partial:unknown[]=[],materialization:unknown[]=[],materialization_gates:unknown[]=[],protection:unknown[]=[],unlinked:unknown[]=[];
 for(const e of events){const d=e.event_data;if(['pending_cancel_ack','pending_cancel_db_claim'].includes(e.event_type)){const id=d.cancel_attempt_id;if(typeof id!=='string'||!id){unlinked.push({event_id:e.id,reason:'missing_attempt_identity'});continue;}if(!attempts.has(id))attempts.set(id,[]);attempts.get(id)!.push(e);}
  if(e.event_type==='materialization_gate_evaluated')materialization_gates.push({event_id:e.id,result:replayRecordedMaterializationGate(d,asOf)});
  if(e.event_type==='materialization_write_observed')materialization.push({event_id:e.id,result:replayRecordedMaterializationWrite(d,asOf)});
  if(e.event_type==='protective_action_evaluated'){const clock=Date.parse(String(d.observed_at));protection.push({event_id:e.id,result:Number.isFinite(clock)&&clock<=asOf?replayRecordedProtectiveAction(d):{status:'unknown',reason:'missing_or_future_protective_clock'},current_protection:'not_established'});}
  if(e.event_type==='protective_order_acknowledged')protection.push({event_id:e.id,result:replayRecordedProtectiveAcknowledgement(d,asOf,asOf),current_protection:'not_established'});
  if(e.event_type==='partial_fill_requery')partial.push({event_id:e.id,result:replayRecordedPartialRequery(d,asOf),materialized_position:'not_established'});
 }
 const updates: {order_id:string;resulting_status:string;cancel_attempt_id:string}[]=[],cancellations:unknown[]=[];
 for(const [id,rows]of attempts){const a=rows.filter(r=>r.event_type==='pending_cancel_ack'),c=rows.filter(r=>r.event_type==='pending_cancel_db_claim');let result:any;
  if(a.length!==1||c.length!==1)result={status:'unknown',reason:'missing_or_duplicate_cancel_evidence'};
  else if(rows.indexOf(a[0])>=rows.indexOf(c[0]))result={status:'unknown',reason:'claim_precedes_ack'};
  else{const ac=Date.parse(String(a[0].event_data.observed_at)),cc=Date.parse(String(c[0].event_data.observed_at));if(!Number.isFinite(ac)||!Number.isFinite(cc)||ac>cc||cc>asOf)result={status:'unknown',reason:'invalid_cancel_clock'};else result=replayRecordedCancelClaim(a[0].event_data,c[0].event_data);}
  cancellations.push({cancel_attempt_id:id,result,ack_result:a.length===1?replayRecordedCancelAck(a[0].event_data):null});
  if(result.status==='evaluated'&&result.occupancy_released&&typeof a[0]?.event_data.order_id==='string')updates.push({order_id:a[0].event_data.order_id as string,resulting_status:result.resulting_status,cancel_attempt_id:id});
 }
 const repeated=new Set(updates.filter((u,i)=>updates.some((v,j)=>i!==j&&u.order_id===v.order_id)).map(u=>u.order_id));
 return {materialization_attempts:composeMaterializationAttempts(events,asOf),cancellations,partial,materialization,materialization_gates,protection,unlinked,observed_terminal_updates:updates.filter(u=>!repeated.has(u.order_id)),conflicting_order_ids:[...repeated],initial_occupancy:null,current_positions:null,full_portfolio_state:'not_established' as const};
}

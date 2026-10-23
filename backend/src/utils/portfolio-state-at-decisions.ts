import {replayRecordedEntryOccupancy} from './recorded-entry-occupancy';
import {projectSeededLocalMaterialization} from './seeded-local-materialization';
import {replayAccountOverwriteTimeline} from './recorded-account-timeline';
interface Event {id:string|number;timestamp:string;event_type:string;event_data:Record<string,any>}
/** Conditional observed prefixes, never a complete or causally verified portfolio state. */
export function portfolioStateAtDecisions(seed:unknown,events:Event[],asOf:number){
 const checkpoints=events.filter(e=>e.event_type==='entry_trace'&&['entry_occupancy_evaluated','symbol_exposure_evaluated','post_quantity_evaluated'].includes(e.event_data.stage)).map(e=>{
  const input=e.event_data.input??{},clock=Date.parse(input.read_started_at??e.timestamp);
  if(!Number.isFinite(clock)||clock>asOf)return {event_id:e.id,status:'unknown',reason:'invalid_or_future_decision_clock',current_full_state:null};
  const returned=input.read_returned_at==null?clock:Date.parse(input.read_returned_at);
  if(!Number.isFinite(returned)||returned<clock||returned>asOf)return {event_id:e.id,status:'unknown',reason:'invalid_or_future_decision_read_interval',current_full_state:null};
  // Earlier insertion does not establish earlier transaction commit/publication.
  const prefix=events.filter(r=>Number.isFinite(Date.parse(r.timestamp))&&Date.parse(r.timestamp)<clock);
  const inventory=projectSeededLocalMaterialization(seed,prefix,clock),account=replayAccountOverwriteTimeline(prefix,clock,seed);
  const mismatches:string[]=[],unresolved:string[]=[];
  // Later-published evidence can diagnose a read/write race, but cannot be
  // inserted into the earlier decision prefix as if already known then.
  const overlappingWrites=events.filter(r=>{
   if(!Number.isFinite(Date.parse(r.timestamp))||Date.parse(r.timestamp)>asOf)return false;
   const d=r.event_data;
   const start=r.event_type==='atomic_verified_close_committed'?d.transaction_started_at:d.write_started_at;
   const end=r.event_type==='atomic_verified_close_committed'?d.committed_return_at:d.write_returned_at??d.applied_at;
   const a=Date.parse(start),b=Date.parse(end);
   return Number.isFinite(a)&&Number.isFinite(b)&&a<=b&&a<=returned&&b>=clock;
  }).map(r=>({event_id:r.id,event_type:r.event_type,publication_at:r.timestamp,reason:'write_return_interval_overlaps_decision_read'}));
  for(const write of overlappingWrites)unresolved.push('write_visibility_overlap:'+write.event_id);
  if(input.read_returned_at==null)unresolved.push('missing_decision_read_return_clock');
  if(e.event_data.stage==='entry_occupancy_evaluated'&&inventory.status==='conditional_local_projection'){
   if(replayRecordedEntryOccupancy(input,asOf).status!=='evaluated')unresolved.push('unverified_occupancy_read');
   for(const [rows,observed,key] of [[inventory.positions,input.open_positions,'position_id'],[inventory.pending,input.pending_orders,'order_id']] as const){
    if(!Array.isArray(observed)){unresolved.push('missing_recorded_'+key+'_inventory');continue;}
    const active=key==='position_id'?['open','reconciliation_failed_not_on_binance']:['pending','partially_filled','reconciliation_failed_not_on_binance'];
    for(const recorded of observed){if(!recorded||typeof recorded[key]!=='string'){unresolved.push('invalid_recorded_identity:'+key);continue;}if(!rows.some(p=>p[key]===recorded[key]))unresolved.push('recorded_identity_missing_from_projection:'+key+':'+recorded[key]);}
    for(const p of rows){if(active.includes(p.status)&&!observed.some((r:any)=>r?.[key]===p[key]))unresolved.push('projected_active_identity_missing_from_read:'+key+':'+p[key]);}
    // Set disagreement remains unresolved without complete writer/query-scope coverage.
    for(const p of rows){const recorded=observed.find((r:any)=>r?.[key]===p[key]);if(!recorded)continue;if(p.side&&recorded.side?.toLowerCase()!==p.side.toLowerCase())mismatches.push('direction_conflict:'+key+':'+p[key]);if(p.status!==recorded.status)unresolved.push('status_lineage_conflict:'+key+':'+p[key]);}
   }
  }
  return {event_id:e.id,trace_id:e.event_data.trace_id??null,stage:e.event_data.stage,at:new Date(clock).toISOString(),read_returned_at:input.read_returned_at??null,clock_basis:input.read_started_at?'recorded_read_start':'insert_timestamp_not_verified_decision_time',status:'conditional_observed_prefix',prefix_event_ids:prefix.map(r=>r.id),inventory,account,mismatches,unresolved,overlapping_writes:overlappingWrites,current_full_state:null,causal_publication_and_commit_lineage:'not_established',economic_roi:null};
 });
 return {schema:'portfolio-state-at-decisions-v1',checkpoints,full_portfolio_parity:'not_established',economic_roi:null};
}

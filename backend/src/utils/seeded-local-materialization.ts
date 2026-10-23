import {replayAtomicVerifiedClose} from './atomic-verified-close';
import {replayRecordedCancelClaim} from './pending-cancel-transition';
import {replayPositionReductionWrite} from './position-reduction-write-observation';
import {replayPositionCloseWrite} from './position-close-write-observation';
import {replayPendingCreation} from './pending-create-observation';
import {replayRecordedAccountState} from './recorded-account-state';
import {composeMaterializationAttempts,type MaterializationEvent} from './materialization-attempt-composition';
import {replayRecordedMaterializationWrite} from './recorded-materialization-write';
/** Forward conditional local projection. Other writers, exchange state and full coverage remain prerequisites. */
export function projectSeededLocalMaterialization(seed:unknown,events:MaterializationEvent[],asOf:number){
 const s=replayRecordedAccountState(seed,asOf);if(s.status!=='observed')return {status:'unknown' as const,reason:'invalid_or_missing_initial_seed',seed_validation:s};
 const raw=seed as Record<string,any>,begin=Date.parse(raw.read_started_at),known=Date.parse(raw.known_at),positions=new Map<string,Record<string,any>>(),pending=new Map<string,Record<string,any>>();
 for(const p of s.local_inventory.positions)positions.set(p.position_id,{...p});for(const p of s.local_inventory.pending)pending.set(p.order_id,{...p});
 const unknown:{event_id:string|number;reason:string}[]=[],applied:(string|number)[]=[],excluded:(string|number)[]=[],seen=new Set<string>();
 const idCounts=new Map<string,number>();for(const e of events)idCounts.set(String(e.id),(idCounts.get(String(e.id))??0)+1);
 const composed=composeMaterializationAttempts(events,asOf),verifiedAttempts=new Map(composed.attempts.filter(a=>a.status==='observed_local_delta').map(a=>[a.materialization_attempt_id,a])),validAttempts=new Set(verifiedAttempts.keys());
 const cancelClaims:MaterializationEvent[]=events.filter(e=>e.event_type==='pending_cancel_db_claim').map(e=>({...e,event_data:{...e.event_data,write_started_at:e.event_data.observed_at,write_returned_at:e.event_data.observed_at}}));
 const atomicWrites:MaterializationEvent[]=events.filter(e=>e.event_type==='atomic_verified_close_committed').map(e=>({...e,event_data:{...e.event_data,write_started_at:e.event_data.transaction_started_at,write_returned_at:e.event_data.committed_return_at}}));
 const writes=[...events.filter(e=>e.event_type==='position_reduction_write_observed'||e.event_type==='materialization_write_observed'||e.event_type==='position_close_write_observed'||e.event_type==='entry_trace'&&e.event_data.stage==='pending_create_write_observed'),...cancelClaims,...atomicWrites].sort((a,b)=>Date.parse(a.event_data.write_returned_at)-Date.parse(b.event_data.write_returned_at));
 for(const e of writes){const d=e.event_data,key=String(e.id);if(seen.has(key)||idCounts.get(key)!==1){unknown.push({event_id:e.id,reason:'duplicate_event_id'});continue;}seen.add(key);
 const a=Date.parse(d.write_started_at),b=Date.parse(d.write_returned_at);if(!Number.isFinite(a)||!Number.isFinite(b)||a>b||b>asOf){unknown.push({event_id:e.id,reason:'invalid_write_clock'});continue;}
 if(b<begin){excluded.push(e.id);continue;}if(a<=known){unknown.push({event_id:e.id,reason:'write_overlaps_seed_boundary'});continue;}
 if(e.event_type==='atomic_verified_close_committed'){
  const r=replayAtomicVerifiedClose(d,asOf),p=positions.get(d.position_id);
  const repeated=atomicWrites.filter(w=>w.event_data.position_id===d.position_id).length!==1;
  const overlaps=writes.some(w=>w!==e&&w.event_data.position_id===d.position_id&&Date.parse(w.event_data.write_started_at)<=b&&Date.parse(w.event_data.write_returned_at)>=a);
  if(r.status!=='evaluated'||!r.matches_recorded||r.account_id!==s.account_id||repeated||overlaps||!p||!['open','reconciliation_failed_not_on_binance','created_local_contract'].includes(p.status)){unknown.push({event_id:e.id,reason:'unverified_atomic_position_close'});continue;}
  positions.set(r.position_id,{...p,...r.expected_position_update,exchange_round_coverage:'not_established'});applied.push(e.id);continue;
 }
 if(e.event_type==='pending_cancel_db_claim'){

  const acks=events.filter(w=>w.event_type==='pending_cancel_ack'&&w.event_data.cancel_attempt_id===d.cancel_attempt_id),claims=cancelClaims.filter(w=>w.event_data.cancel_attempt_id===d.cancel_attempt_id);
  if(acks.length!==1||claims.length!==1){unknown.push({event_id:e.id,reason:'ambiguous_cancel_attempt'});continue;}
  const ack=acks[0].event_data,clock=Date.parse(ack.observed_at),result=replayRecordedCancelClaim(ack,d),p=pending.get(ack.order_id);
  if(!Number.isFinite(clock)||clock<=known||clock>b||result.status!=='evaluated'){unknown.push({event_id:e.id,reason:'unverified_forward_cancel'});continue;}
  if(!result.occupancy_released)continue;
  if(!p||p.status!==ack.pending_status){unknown.push({event_id:e.id,reason:'cancel_pre_state_not_established'});continue;}
  pending.set(ack.order_id,{...p,status:result.resulting_status,cancel_clock_basis:'observed_receipt_not_verified_commit',cancel_attempt_id:d.cancel_attempt_id});applied.push(e.id);continue;
 }
 if(e.event_type==='position_reduction_write_observed'){

  const rr=replayPositionReductionWrite(d,asOf);
  if(rr.status!=='local_reduction_contract_replayed'||rr.account_id!==s.account_id){unknown.push({event_id:e.id,reason:'unverified_position_reduction'});continue;}
  const attempts=writes.filter(w=>w.event_type==='position_reduction_write_observed'&&w.event_data.reduction_attempt_id===rr.attempt_id);
  if(attempts.length!==1){unknown.push({event_id:e.id,reason:'duplicate_reduction_attempt'});continue;}
  const overlaps=writes.some(w=>w!==e&&w.event_type==='position_reduction_write_observed'&&w.event_data.position_id===rr.position_id&&Date.parse(w.event_data.write_started_at)<=b&&Date.parse(w.event_data.write_returned_at)>=a);
  if(overlaps){unknown.push({event_id:e.id,reason:'overlapping_reduction_writes'});continue;}
  const p=positions.get(rr.position_id);
  if(!p||!['side','status','size_qty','size_usd','partial_closed'].every(k=>p[k]===rr.before[k])){unknown.push({event_id:e.id,reason:'reduction_pre_state_not_established'});continue;}
  positions.set(rr.position_id,{...p,...rr.update,exchange_fill_verification:'not_established'});applied.push(e.id);continue;
 }
 if(e.event_type==='position_close_write_observed'){
  const cr=replayPositionCloseWrite(d,asOf);if(cr.status!=='local_close_contract_replayed'||cr.account_id!==s.account_id){unknown.push({event_id:e.id,reason:'unverified_position_close'});continue;}
  const p=positions.get(cr.position_id);if(!p){unknown.push({event_id:e.id,reason:'closed_position_not_in_projection'});continue;}
  positions.set(cr.position_id,{...p,...cr.update,...(cr.kind==='close_financial_update'&&p.status!=='closed'?{status:'unknown_after_close_financial_write'}:{}),exchange_round_coverage:'not_established'});applied.push(e.id);continue;
 }
 if(e.event_type==='entry_trace'){
  const pr=replayPendingCreation(d,asOf);if(pr.status!=='pending_create_contract_replayed'||pr.account_id!==s.account_id){unknown.push({event_id:e.id,reason:'unverified_pending_creation'});continue;}
  if(pending.has(pr.order_id)){unknown.push({event_id:e.id,reason:'pending_already_in_projection'});continue;}
  // Preserve the production create row's logical fields; uncertainty belongs
  // in provenance, not a synthetic status that breaks subsequent transitions.
  const i=pr.input;
  pending.set(pr.order_id,{order_id:pr.order_id,account_id:pr.account_id,binance_order_id:i.binanceOrderId,
    symbol:i.symbol.toUpperCase(),side:i.side,entry_price:i.entryPrice,stop_loss:i.stopLoss,take_profit:i.takeProfit,
    size_usd:i.sizeUsd,size_qty:i.sizeQty,risk_usd:i.riskUsd,risk_percent:i.riskPercent,expected_rr:i.expectedRr,
    invalidation_level:i.invalidationLevel,method_id:i.methodId||'ict',status:'pending',
    local_state_basis:'verified_pending_create_contract',exchange_order_state:'not_established'});applied.push(e.id);continue;
 }
 if(d.account_id!==s.account_id){unknown.push({event_id:e.id,reason:'different_account'});continue;}
 const r=replayRecordedMaterializationWrite(d,asOf);if(r.status!=='write_contract_replayed'){unknown.push({event_id:e.id,reason:'unverified_write'});continue;}
 if(r.kind==='create_position'){
  if(!validAttempts.has(d.materialization_attempt_id)){unknown.push({event_id:e.id,reason:'missing_verified_creation_inputs'});continue;}
  if(positions.has(r.position_id)){unknown.push({event_id:e.id,reason:'position_already_in_projection'});continue;}
  positions.set(r.position_id,{position_id:r.position_id,account_id:r.account_id,symbol:r.input.symbol,side:r.input.side,size_qty:r.input.sizeQty,size_usd:r.input.sizeUsd,stop_loss:r.input.stopLoss,take_profit:r.input.takeProfit,entry_price:r.input.entryPrice,risk_usd:r.input.riskUsd,status:'open',local_state_basis:'verified_materialization_create_contract',active_protection:'not_established'});applied.push(e.id);
 }else{
  const p=pending.get(r.order_id);if(!p){unknown.push({event_id:e.id,reason:'pending_not_in_seed_or_creation_inventory'});continue;}
  const attempt=verifiedAttempts.get(d.materialization_attempt_id),position=positions.get(r.position_id);
  const executes=writes.filter(w=>w.event_type==='materialization_write_observed'&&w.event_data.kind==='execute_pending'&&w.event_data.order_id===r.order_id);
  if(executes.length!==1){unknown.push({event_id:e.id,reason:'ambiguous_pending_execution'});continue;}
  if(!attempt||attempt.status!=='observed_local_delta'||attempt.created_position?.position_id!==r.position_id||attempt.pending_update?.order_id!==r.order_id||attempt.pending_update?.status!==r.pending_status||!position){unknown.push({event_id:e.id,reason:'pending_position_lineage_not_established'});continue;}
  if(!['pending','partially_filled','reconciliation_failed_not_on_binance','created_pending_contract'].includes(p.status)){unknown.push({event_id:e.id,reason:'pending_execution_pre_state_not_established'});continue;}
  if((p.side!=null&&(typeof p.side!=='string'||p.side.toLowerCase()!==position.side.toLowerCase()))||(p.symbol!=null&&p.symbol!==position.symbol)){unknown.push({event_id:e.id,reason:'pending_position_identity_conflict'});continue;}
  pending.set(r.order_id,{...p,status:r.pending_status,observed_position_id:r.position_id,materialization_attempt_id:d.materialization_attempt_id,position_link_basis:'verified_local_create_execute_contracts',persisted_position_link:'not_established'});
  positions.set(r.position_id,{...position,observed_order_id:r.order_id,materialization_attempt_id:d.materialization_attempt_id,order_link_basis:'verified_local_create_execute_contracts'});applied.push(e.id);
 }
 }
 return {status:'conditional_local_projection' as const,account_id:s.account_id,positions:[...positions.values()],pending:[...pending.values()],applied_event_ids:applied,excluded_pre_seed_event_ids:excluded,unknown,initial_seed_known_at:s.seed_not_before,current_full_state:null,mutation_coverage:'not_established' as const,economic_roi:null};
}

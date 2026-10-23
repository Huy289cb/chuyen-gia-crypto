import {replayRecordedEntryPriceFeasibility} from './entry-price-feasibility';
import {replayRecordedQuantityCheck,replayRecordedExecutionRisk,replayRecordedTargetSizing} from './recorded-quantity-risk';
import {replayRecordedEntryOccupancy} from './recorded-entry-occupancy';
import {replayRecordedSymbolExposure} from './recorded-symbol-exposure';
import {replayRecordedEntryHistoryCooldown} from './recorded-entry-history-cooldown';
import {replayRecordedPostQuantity} from './recorded-post-quantity';
import {replayRecordedAccountGuardInvocation} from './recorded-account-guard-invocation';
interface Event{id:string|number;timestamp:string;event_type:string;event_data:Record<string,any>}
/** Joins supplied observations only; never supplies missing state to a counterfactual engine. */
export function composeTraceAdmission(events:readonly Event[],asOf:number,observationKnownAt:number=Infinity){
 const groups=new Map<string,Event[]>(),unlinked:(string|number)[]=[];
 const counts=new Map<string,number>();for(const e of events)counts.set(String(e.id),(counts.get(String(e.id))??0)+1);
 for(const e of events){if(e.event_type!=='entry_trace')continue;const id=e.event_data?.trace_id;if(typeof id!=='string'||!id){unlinked.push(e.id);continue;}if(!groups.has(id))groups.set(id,[]);groups.get(id)!.push(e);}
 const traces=[...groups].map(([trace_id,rows])=>{
  const gaps:string[]=[],unknown:string[]=[],eligible=rows.filter(e=>Number.isFinite(Date.parse(e.timestamp))&&Date.parse(e.timestamp)<=asOf);
  if(eligible.length!==rows.length)unknown.push('invalid_or_future_recorded_timestamp');if(rows.some(e=>counts.get(String(e.id))!==1))unknown.push('duplicate_event_identity');
  const select=(stage:string)=>{const x=eligible.filter(e=>e.event_data.stage===stage);if(x.length>1)unknown.push('ambiguous_'+stage);return x.length===1?x[0]:undefined;};
  const o=select('entry_occupancy_evaluated'),x=select('symbol_exposure_evaluated'),q=select('post_quantity_evaluated');
  const occupancy=o?replayRecordedEntryOccupancy(o.event_data.input,asOf):null,exposure=x?replayRecordedSymbolExposure(x.event_data.input,asOf):null,quantity=q?replayRecordedPostQuantity(q.event_data.input??{}):null;
  for(const [name,e,result]of [['occupancy',o,occupancy],['exposure',x,exposure],['post_quantity',q,quantity]] as const){if(!e)gaps.push('missing_'+name);else if(result?.status!=='evaluated')unknown.push('unverified_'+name);else{const decision=name==='exposure'?(result as any).expected:(result as any).decision;if(JSON.stringify(decision)!==JSON.stringify(e.event_data.decision))unknown.push('mismatch_'+name);}}
  const rawQuantity=select('quantity_checked'),riskRow=select('risk_checked');
  const quantityCheck=rawQuantity?replayRecordedQuantityCheck(rawQuantity.event_data):null,riskCheck=riskRow?replayRecordedExecutionRisk(riskRow.event_data):null;
  const targetSizing=rawQuantity?replayRecordedTargetSizing(rawQuantity.event_data):null;
  const feasibilityRows=eligible.filter(e=>e.event_data.stage==='entry_price_feasibility_evaluated');
  const price_feasibility=feasibilityRows.map(e=>({event_id:e.id,input:e.event_data.feasibility,result:replayRecordedEntryPriceFeasibility(e.event_data.feasibility,asOf)}));
  if(!price_feasibility.length)gaps.push('missing_early_price_feasibility');
  if(price_feasibility.some(p=>p.result.status!=='evaluated'||!p.result.matches_recorded))unknown.push('unverified_early_price_feasibility');
  const prices=price_feasibility.filter(p=>p.input?.stage==='price_levels'),floors=price_feasibility.filter(p=>p.input?.stage==='stop_floor');
  if(prices.length>1||floors.length>1)unknown.push('ambiguous_early_price_feasibility');
  const price=prices.length===1?prices[0]:undefined,floor=floors.length===1?floors[0]:undefined;
  if(floor&&!price)unknown.push('floor_without_price_levels');
  if(price&&floor){
   if(['feasibility_attempt_id','side','symbol','method_id'].some(k=>price.input[k]!==floor.input[k])||['entry','stop_loss'].some(k=>JSON.stringify(price.input[k])!==JSON.stringify(floor.input[k])))unknown.push('price_floor_input_conflict');
   if(Date.parse(price.input.observed_at)>Date.parse(floor.input.observed_at))unknown.push('floor_precedes_price_levels');
  }
  const priceVeto=price?.result.status==='evaluated'&&price.result.expected!==null;
  const floorVeto=floor?.result.status==='evaluated'&&(floor.result.expected as any)?.block!==null;
  if(priceVeto&&(floor||rawQuantity||riskRow||q))unknown.push('downstream_after_price_veto');
  if(floorVeto&&(rawQuantity||riskRow||q))unknown.push('downstream_after_floor_veto');
  if(rawQuantity&&price){const a=rawQuantity.event_data,b=price.input;if(a.side!==b.side||JSON.stringify({status:'finite',value:a.entry})!==JSON.stringify(b.entry)||JSON.stringify({status:'finite',value:a.stop_loss})!==JSON.stringify(b.stop_loss))unknown.push('price_quantity_input_conflict');}
  if(rawQuantity&&!floor)gaps.push('missing_stop_floor_before_quantity');
  const financialUnknown:string[]=[];
  if(rawQuantity&&!(targetSizing?.status==='evaluated'&&targetSizing.matches_recorded))financialUnknown.push('unverified_target_sizing');
  if(rawQuantity&&!(quantityCheck?.status==='evaluated'&&quantityCheck.matches_recorded))financialUnknown.push('unverified_quantity_check');
  if(riskRow&&!(riskCheck?.status==='evaluated'&&riskCheck.matches_recorded))financialUnknown.push('unverified_risk_check');
  if(rawQuantity&&riskRow){const a=rawQuantity.event_data,b=riskRow.event_data;if(['side','entry','stop_loss','account_balance','normalized_quantity'].some(k=>a[k]!==b[k]))financialUnknown.push('quantity_risk_input_conflict');if(quantityCheck?.status==='evaluated'&&!quantityCheck.expected.valid)financialUnknown.push('risk_after_quantity_veto');}
  if(riskRow&&q){const a=riskRow.event_data,b=q.event_data.input;if(!b||a.side!==b.side||a.entry!==b.entry||a.stop_loss!==b.stopLoss||a.totalRiskUsd!==b.effectiveRiskUsd||a.riskPercent!==b.effectiveRiskPercent||a.cap_usd!==b.effectiveRiskCapUsd||a.remaining_daily_risk_usd!==b.remainingDailyRiskUsd)financialUnknown.push('risk_post_quantity_conflict');}
  if(q&&!(quantity?.status==='evaluated'&&JSON.stringify(quantity.decision)===JSON.stringify(q.event_data.decision)))financialUnknown.push('unverified_financial_post_quantity');
  unknown.push(...financialUnknown);
  const financial_chain={status:!rawQuantity||!riskRow||!q?'partial':financialUnknown.length?'unknown':'observed_financial_contracts',targetSizing,quantityCheck,riskCheck,actual_exchange_filter_and_cost_coverage:'not_established',economic_roi:null};
  const ids=[o?.event_data.input?.read_id,x?.event_data.input?.read_id].filter(v=>typeof v==='string');if(new Set(ids).size!==ids.length)unknown.push('duplicate_read_identity');
  if(o&&x&&Date.parse(o.event_data.input?.observed_at)>Date.parse(x.event_data.input?.read_started_at))unknown.push('exposure_precedes_occupancy_completion');
  if(x&&q&&Date.parse(x.event_data.input?.observed_at)>Date.parse(q.timestamp))unknown.push('post_quantity_publication_precedes_exposure');
  if(occupancy?.status==='evaluated'&&occupancy.decision!==null&&(x||q))unknown.push('downstream_after_occupancy_veto');
  if(occupancy?.status==='evaluated'&&o&&q&&o.event_data.input.side!==q.event_data.input?.side)unknown.push('direction_conflict');
  const histories=eligible.filter(e=>e.event_data.stage==='entry_history_cooldown_evaluated').map(e=>{const result=replayRecordedEntryHistoryCooldown(e.event_data.input,asOf);return {event_id:e.id,result,matches_recorded:result.status==='evaluated'?result.decision===e.event_data.decision:null};});
  if(!histories.length)gaps.push('missing_history_reads');if(histories.some(h=>h.matches_recorded!==true))unknown.push('unverified_history');
  const guardGroups=new Map<string,Event[]>();for(const e of eligible){const id=e.event_data.guard_invocation_id;if(typeof id!=='string')continue;if(!guardGroups.has(id))guardGroups.set(id,[]);guardGroups.get(id)!.push(e);}
  const guards=[...guardGroups].map(([id,rr])=>({guard_invocation_id:id,result:replayRecordedAccountGuardInvocation(rr.map(e=>({known_at:observationKnownAt,data:e.event_data})),asOf)}));
  if(!guards.length)gaps.push('missing_guard_invocation');if(guards.some(g=>g.result.status!=='decisions_replayed'))unknown.push('unverified_guard');
  // Production also checks health, opposite flip, scale-side exchange state and price feasibility.
  const prerequisites=['binance_health_and_scale_side_not_joined','price_and_quantity_feasibility_not_joined','execution_read_roles_and_causal_account_lineage_not_established','complete_evolving_portfolio_state_not_established','independent_wave_and_economic_cost_coverage_not_established'];
  return {trace_id,status:unknown.length?'unknown' as const:o&&x&&q?'observed_read_subsequence' as const:'partial' as const,event_ids:rows.map(e=>e.id),occupancy,exposure,quantity,financial_chain,price_feasibility,histories,guards,unknown,gaps,remaining_prerequisites:prerequisites,post_quantity_clock_basis:'recorded_insert_timestamp_not_verified_publication_or_decision_time',final_admission:null,candidate_execution:'not_run_gates_incomplete',economic_roi:null};
 });
 return {schema:'trace-admission-observation-composition-v1',traces,unlinked_event_ids:unlinked,full_portfolio_parity:'not_established',economic_roi:null};
}

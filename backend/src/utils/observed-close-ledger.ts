import {replayAtomicVerifiedClose} from './atomic-verified-close';
import {replayRecordedCloseRound} from './recorded-close-round';
import {replayPositionCloseWrite} from './position-close-write-observation';
import {replayRecordedCloseAccount} from './recorded-close-account';
interface Event{id:string|number;timestamp:string;position_id?:string;event_type:string;event_data:Record<string,any>}
/** Deployed verified fill.realizedPnl = round.netPnl. Fees must not be subtracted twice. */
export function buildObservedCloseLedger(events:Event[],asOf:number,since?:number){
 const financial=events.filter(e=>e.event_type==='position_close_write_observed'&&e.event_data.kind==='close_financial_update');
 const atomic=events.filter(e=>e.event_type==='atomic_verified_close_committed');
 const closeCount=(id:string)=>[...financial,...atomic].filter(e=>e.event_data.position_id===id).length;
 const eventCount=(id:string|number)=>events.filter(e=>String(e.id)===String(id)).length;
 const rows=financial.map(e=>{
  const d=e.event_data,r=replayPositionCloseWrite(d,asOf),unknown=(reason:string)=>({event_id:e.id,position_id:d.position_id??null,status:'unknown' as const,reason,net_pnl:null});
  if(eventCount(e.id)!==1)return unknown('duplicate_event_identity');
  if(r.status!=='local_close_contract_replayed')return unknown('unverified_financial_write');
  if(!d.fill_verified||d.bookkeeping)return unknown('not_verified_economic_close');
  if(closeCount(d.position_id)!==1)return unknown('duplicate_or_revised_position_financial_write');
  const status=events.filter(f=>f.event_type==='position_close_write_observed'&&f.event_data.kind==='close_status'&&f.event_data.close_attempt_id===d.close_attempt_id&&f.event_data.position_id===d.position_id&&f.event_data.account_id===d.account_id);
  if(status.length!==1)return unknown('missing_or_duplicate_close_status');
  const sr=replayPositionCloseWrite(status[0].event_data,asOf);
  if(sr.status!=='local_close_contract_replayed'||Date.parse(status[0].event_data.write_returned_at)>Date.parse(d.write_started_at))return unknown('invalid_close_status_lineage');
  const accounts=events.filter(f=>f.event_type==='close_account_update_applied'&&f.position_id===d.position_id&&f.event_data.account_id===d.account_id);
  if(accounts.length!==1)return unknown('missing_or_duplicate_account_application');
  const a=accounts[0],ar=replayRecordedCloseAccount(a.event_data,Date.parse(a.timestamp),asOf);
  if(ar.status!=='evaluated'||!ar.matches_recorded||ar.application_ordering!=='db_return_observed'||a.event_data.input.realized_pnl!==d.input.realized_pnl||Date.parse(a.event_data.applied_at)<Date.parse(d.write_returned_at))return unknown('account_financial_lineage_conflict');
  return {event_id:e.id,position_id:d.position_id,account_id:d.account_id,status:'observed_net_close_contract' as const,net_pnl:d.input.realized_pnl,entry_fee:d.input.entry_fee,exit_fee:d.input.exit_fee,funding_fee:d.input.funding_fee,fee_basis:'already_in_verified_round_net_pnl',exchange_round_identity_coverage:'not_established',account_event_id:a.id};
 });
 for(const e of atomic){
  const r=replayAtomicVerifiedClose(e.event_data,Math.min(asOf,Date.parse(e.timestamp)));
  if(r.status!=='evaluated'||!r.matches_recorded||e.position_id!==r.position_id||closeCount(e.event_data.position_id)!==1||eventCount(e.id)!==1){rows.push({event_id:e.id,position_id:e.event_data.position_id??null,status:'unknown',reason:'unverified_or_duplicate_atomic_close',net_pnl:null});continue;}
  const p=r.expected_position_update;
  rows.push({event_id:e.id,position_id:r.position_id,account_id:r.account_id,status:'observed_net_close_contract',net_pnl:p.realized_pnl,entry_fee:p.entry_fee,exit_fee:p.exit_fee,funding_fee:p.funding_fee,fee_basis:'already_in_verified_round_net_pnl',exchange_round_identity_coverage:'not_established',account_event_id:e.id});
 }
 const roundRows=events.filter(e=>e.event_type==='close_round_query_observed').map(e=>({event:e,result:replayRecordedCloseRound(e.event_data,Date.parse(e.timestamp),asOf)}));
 const reconciliations=rows.map(row=>{
  const matches=roundRows.filter(r=>r.event.position_id===row.position_id);
  const reductions=events.filter(e=>e.event_type==='position_reduction_write_observed'&&e.event_data.position_id===row.position_id);
  if(row.status!=='observed_net_close_contract'||matches.length!==1)return {event_id:row.event_id,status:'unknown',reason:matches.length!==1?'missing_or_ambiguous_round_query':'unverified_close_contract',partial_reduction_events:reductions.map(e=>e.id)};
  const result=matches[0].result;
  if(result.status!=='evaluated')return {event_id:row.event_id,status:'unknown',reason:result.reason,partial_reduction_events:reductions.map(e=>e.id)};
  const round=result.round,eq=(a:number,b:number)=>Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
  const valuesMatch=eq(row.net_pnl,round.netPnl)&&eq(row.entry_fee,round.entryFee)&&eq(row.exit_fee,round.exitFee)&&eq(row.funding_fee,round.fundingFee);
  const identities=new Set(round.fills.map(f=>String(f.tradeId)));
  const reused=roundRows.some(r=>r!==matches[0]&&r.event.position_id!==row.position_id&&r.result.status==='evaluated'&&r.result.round.fills.some(f=>identities.has(String(f.tradeId))));
  const fundingIds=new Set(round.funding.map(f=>String(f.tranId)));
  const fundingReused=roundRows.some(r=>r!==matches[0]&&r.event.position_id!==row.position_id&&r.result.status==='evaluated'&&r.result.round.funding.some(f=>fundingIds.has(String(f.tranId))));
  return {event_id:row.event_id,round_event_id:matches[0].event.id,status:valuesMatch&&!reused&&!fundingReused?'observed_round_matches_close_contract':'unknown',reason:reused?'exchange_fill_identity_reused_across_positions':fundingReused?'funding_identity_reused_across_positions':valuesMatch?null:'round_financial_values_conflict',trade_ids:[...identities],funding_ids:[...fundingIds],partial_reduction_events:reductions.map(e=>e.id),partial_realizations_account_coverage:'not_established'};
 });
 const periodRows=reconciliations.map(r=>{
  const unknown=(reason:string)=>({event_id:r.event_id,status:'unknown' as const,reason,net_cashflow:null});
  if(!Number.isFinite(since)||!Number.isFinite(asOf)||since! >= asOf)return unknown('missing_or_invalid_period_boundary');
  if(r.status!=='observed_round_matches_close_contract')return unknown(r.reason??'round_not_reconciled');
  const replay=roundRows.find(q=>q.event.id===r.round_event_id)?.result;
  if(!replay||replay.status!=='evaluated')return unknown('round_not_reconciled');
  const fills=replay.round.fills.filter(f=>f.time>since!&&f.time<=asOf),funding=replay.round.funding.filter(f=>f.time>since!&&f.time<=asOf);
  const gross=fills.reduce((sum,f)=>sum+f.realizedPnl,0),fees=fills.reduce((sum,f)=>sum+f.commission,0),income=funding.reduce((sum,f)=>sum+Number(f.income),0),net=gross-fees+income;
  if(![gross,fees,income,net].every(Number.isFinite))return unknown('nonfinite_period_cashflow');
  return {event_id:r.event_id,status:'observed_period_cashflow' as const,reason:null,realized_gross_pnl:gross,trading_fees:fees,funding_income:income,net_cashflow:net,trade_ids:fills.map(f=>String(f.tradeId)),funding_ids:funding.map(f=>String(f.tranId)),round_crosses_period_start:replay.round.entryTime<=since!,basis:'exchange_cashflows_in_open_left_closed_right_window'};
 });
 const periodKnown=periodRows.filter(r=>r.status==='observed_period_cashflow'),periodSubtotal=periodKnown.reduce((sum,r)=>sum+(r.net_cashflow??0),0);
 const known=rows.filter(r=>r.status==='observed_net_close_contract'),subtotal=known.reduce((sum,r)=>sum+(r.net_pnl??0),0);
 return {schema:'observed-close-ledger-v3',rows,round_reconciliation:reconciliations,period_cashflows:{since:Number.isFinite(since)?new Date(since!).toISOString():null,through:Number.isFinite(asOf)?new Date(asOf).toISOString():null,rows:periodRows,observed_subtotal:periodKnown.length&&Number.isFinite(periodSubtotal)?periodSubtotal:null,unknown_rows:periodRows.length-periodKnown.length,portfolio_cashflow_coverage:'not_established'},observed_net_close_subtotal:known.length&&Number.isFinite(subtotal)?subtotal:null,unknown_rows:rows.length-known.length,full_round_partial_fill_and_open_equity_coverage:'not_established',provider_cost_coverage:'separate_incomplete',economic_roi_base:null,economic_roi_stress:null};
}

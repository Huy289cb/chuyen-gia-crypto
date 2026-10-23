'use strict';

// Assess the actual integration result, separating missing evidence from
// missing engine behavior. This never computes performance from partial sums.
function assessCanonicalBaseline(report) {
  const checkpoints = report.portfolio_state_at_decisions?.checkpoints ?? [];
  const ledger = report.observed_close_ledger ?? {};
  const provider = report.provider_cost ?? {};
  const projection = report.local_materialization_projection ?? {};
  const account = report.account_timeline ?? {};
  const blockers = [];
  const add = (id, category, evidence, effect, acceptance) => blockers.push({
    id, category, evidence, effect, acceptance,
  });
  const bundle = report.baseline_input_bundle;
  if (!bundle || bundle.status !== 'temporally_aligned_only') add(
    'production_input_bundle', 'data', bundle?.reasons ?? ['missing_bundle_assessment'],
    'The supplied seed, telemetry and independent provider export cannot establish a common baseline window.',
    'Production exports cover the same fixed window; valid seed precedes it; seed inventory and publication coverage are independently reconciled.');
  if (report.lifecycle?.full_portfolio_state !== 'established' || projection.current_full_state == null || !account.accounts?.length || account.accounts.some(a => a.current_account_state == null)) add(
    'evolving_portfolio_state', 'engine_and_evidence', {
      lifecycle: report.lifecycle?.full_portfolio_state ?? 'missing',
      inventory_status: projection.status ?? 'missing',
      inventory_unknown: projection.unknown ?? [],
      accounts: (account.accounts ?? []).map(a => ({account_id:a.account_id, status:a.status, reason:a.reason, unresolved_increment_fields:a.unresolved_increment_fields, current_state_established:a.current_account_state != null})),
      account_unknown: account.unknown ?? [],
    }, 'Observed contract projections do not establish complete decision-to-exit portfolio state.',
    'Shared production transitions evolve complete seeded account/order/position state; every reachable mutation and decision read reconciles against production evidence.');
  const mismatches = checkpoints.flatMap(c => (c.mismatches ?? []).map(reason => ({event_id:c.event_id, reason})));
  const unresolved = checkpoints.flatMap(c => (c.unresolved ?? []).map(reason => ({event_id:c.event_id, reason})));
  if (!checkpoints.length || report.portfolio_state_at_decisions?.full_portfolio_parity !== 'established' || mismatches.length || unresolved.length) add(
    'decision_state_parity', 'engine_and_evidence', {checkpoints:checkpoints.length, mismatches, unresolved},
    'Entry decisions have no verified full-state parity.',
    'All in-scope decisions, including vetoes, have causal state/read lineage and no unexplained decision or write mismatches.');
  if (ledger.full_round_partial_fill_and_open_equity_coverage !== 'established' || ledger.unknown_rows || ledger.economic_roi_base == null || ledger.economic_roi_stress == null) add(
    'portfolio_economics', 'engine_and_evidence', {
      close_rows:ledger.rows?.length ?? 0, unknown_close_rows:ledger.unknown_rows ?? null,
      round_reconciliation:ledger.round_reconciliation ?? [],
      observed_net_close_subtotal:ledger.observed_net_close_subtotal ?? null,
      period_cashflows:ledger.period_cashflows ?? null,
      coverage:ledger.full_round_partial_fill_and_open_equity_coverage ?? 'missing',
    }, 'A close subtotal cannot determine portfolio ROI, capital-flow-adjusted equity or stress economics.',
    'Reconcile complete fills/partial rounds, capital flows, opening/closing marked equity, fees/funding/slippage and registered stress costs without double counting.');
  if (provider.request_coverage !== 'established' || provider.totalCostUsd == null) add(
    'provider_billing_coverage', 'data_and_reconciliation', {
      requests:provider.requests?.length ?? 0, unknown_requests:provider.unknownRequests ?? null,
      incomplete_pairs:provider.incompletePairs ?? null, unlinked:provider.unlinked ?? null,
      recorded_subtotal_usd:provider.recordedSubtotalUsd ?? null,
      request_coverage:provider.request_coverage ?? 'missing',
    }, 'Empty or individually priced requests do not establish total AI cost.',
    'Independent production request inventory and billing reconcile all in-window attempts, retries and non-trade calls.');
  if (report.baseline?.independent_fills == null) add(
    'independent_fill_identity', 'engine_and_evidence', {
      setup_coverage:report.setup_registry?.coverage ?? null,
      wave_count:report.setup_registry?.independent_wave_count ?? null,
    }, 'Repeated signals cannot be interpreted as additional independent entries.',
    'Verified setup/wave identity propagates to order and exchange fills; ambiguity is reported and independent fills can be counted.');
  const metrics = report.baseline ?? {};
  const allMeasured = ['economic_roi_base','economic_roi_stress','independent_fills'].every(k => Number.isFinite(metrics[k]));
  return {
    schema:'canonical-baseline-assessment-v1',
    status:blockers.length || !allMeasured ? 'insufficient' : 'measured_baseline_requires_gate_review',
    metrics:{economic_roi_base:metrics.economic_roi_base ?? null, economic_roi_stress:metrics.economic_roi_stress ?? null, independent_fills:metrics.independent_fills ?? null},
    blockers, blocker_count:blockers.length,
    candidate_allowed:false,
    next_action:blockers.length ? 'Close named engine/evidence blockers; fixed-window capture supplies evidence but cannot replace missing engine behavior.' : 'Review F/P/E evidence before preregistering at most two mechanisms.',
  };
}
function reconcileObservedEquity(seed, cashflow) {
  const reasons=['raw_opening_equity_not_established','raw_cutoff_equity_not_established','capital_and_income_coverage_not_established','provider_and_incremental_costs_not_reconciled'];
  const asset=cashflow?.account_snapshot?.assets?.find(a=>a.asset==='USDT');
  const amount=v=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
  const opening=amount(seed?.account?.equity),closing=amount(asset?.marginBalance),wallet=amount(asset?.walletBalance),upnl=amount(asset?.unrealizedProfit);
  const valid=cashflow?.schema==='exchange-cashflow-export-v1'&&Array.isArray(cashflow.income)&&cashflow.endpoint_pagination_finished===true;
  const since=Date.parse(cashflow?.since),through=Date.parse(cashflow?.through);
  const period=valid&&Number.isFinite(since)&&Number.isFinite(through)&&since<through?cashflow.income.filter(r=>r.time>since&&r.time<=through):null;
  const usdt=period?.filter(r=>r.asset==='USDT');
  const income=usdt?.every(r=>amount(r.income)!==null)?usdt.reduce((sum,r)=>sum+Number(r.income),0):null;
  const delta=opening!==null&&closing!==null?closing-opening:null;
  if(!valid||period===null)reasons.push('invalid_or_missing_cashflow_export');
  if(opening===null||closing===null)reasons.push('missing_observed_equity_values');
  if(period?.some(r=>r.asset!=='USDT'))reasons.push('non_usdt_income_not_converted');
  const arithmetic=wallet!==null&&closing!==null&&upnl!==null?closing-wallet-upnl:null;
  return {schema:'observed-equity-reconciliation-v1',status:'insufficient',reasons,
    observed_local_seed_equity:opening,observed_later_usdt_equity:closing,
    later_asset_equity_arithmetic_residual:arithmetic,
    local_seed_to_later_raw_equity_delta:delta,observed_endpoint_usdt_income_subtotal:Number.isFinite(income)?income:null,
    conditional_delta_less_income:delta!==null&&Number.isFinite(income)?delta-income:null,
    period_income_rows:period?.length??null,seed_known_at:seed?.known_at??null,
    account_observed_at:cashflow?.account_snapshot?.received_at??null,
    exact_period_equity_change:null,economic_roi_base:null,economic_roi_stress:null,
    limits:'Residual compares a local seed with a later raw snapshot. It is not reconciled portfolio P&L; opening/closing unrealized change, external capital and all costs remain separate. Empty endpoint response is not independent completeness evidence.'};
}
function assessPreAiPlanning(events,asOf){
 const {closedCandlesOnly}=require('../src/utils/closed-candles.ts');
 const {findStructureSwings}=require('../src/utils/structure-bias.ts');
 const {measurePlanGeometry}=require('../src/utils/plan-feasibility.ts');
 const rows=events.filter(e=>e.event_type==='entry_trace'&&e.event_data.stage==='feasibility_before_ai').map(e=>{
  const d=e.event_data,m=d.measurement,unknown=reason=>({event_id:e.id,trace_id:d.trace_id,status:'unknown',reason,full_structural_plan:null});
  if(!m||!Number.isFinite(m.asOf)||m.asOf>asOf||m.version!=='entry-feasibility-v1')return unknown('invalid_or_future_diagnostic');
  if(d.input_schema!==undefined || d.input!==undefined){
   const i=d.input;
   const validBars=b=>Array.isArray(b)&&b.every(r=>r&&typeof r==='object'&&[r.timestamp,r.high,r.low,r.close].every(v=>typeof v==='number'&&Number.isFinite(v))&&r.timestamp>=0&&r.low>0&&r.low<=r.close&&r.close<=r.high);
   if(d.input_schema!=='entry-feasibility-input-v1'||!i||i.asOf!==m.asOf||!['long','short',null].includes(i.side)||
      !['5m','15m','1h','4h'].includes(i.timeframe)||!['5m','15m','1h','4h'].includes(i.structureTimeframe)||
      ![i.minSlFraction,i.minRr].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0)||
      typeof i.graceMs!=='number'||!Number.isFinite(i.graceMs)||i.graceMs<0||
      (i.entry!==undefined&&!(typeof i.entry==='number'&&Number.isFinite(i.entry)&&i.entry>0))||
      !validBars(i.candles)||!validBars(i.structureCandles))return unknown('invalid_exact_diagnostic_input');
   const {observeEntryFeasibility}=require('../src/utils/entry-feasibility-observation.ts');
   const replayed=observeEntryFeasibility(i);
   const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
   const matches=JSON.stringify(canonical(replayed))===JSON.stringify(canonical(m));
   return {event_id:e.id,trace_id:d.trace_id,status:matches?'exact_diagnostic_reconciled':'mismatch',
    input_schema:d.input_schema,diagnostic_replay_matches_recorded:matches,replayed_measurement:replayed,
    pre_ai_passed_records:events.filter(r=>r.event_data.trace_id===d.trace_id&&r.event_data.stage==='pre_ai_passed').length,
    full_structural_plan:null,missing_inputs:['independent_input_publication_lineage','target_liquidity_and_break_or_mitigation_lifecycle'],
    limits:'Exact diagnostic replay only. This rule does not establish the complete production planner, executable target liquidity or portfolio economics.'};
  }
  const structures=events.filter(r=>r.event_type==='entry_trace'&&r.event_data.trace_id===d.trace_id&&r.event_data.stage==='structure_permission_evaluated');
  if(structures.length!==1)return unknown('missing_or_duplicate_structure_context');
  const s=structures[0].event_data.structure_permission;
  if(!s?.input||!Array.isArray(s.input.candles)||s.timeframe!==m.structureTimeframe||Date.parse(s.observed_at)>m.asOf||!Number.isFinite(Date.parse(s.observed_at)))return unknown('invalid_structure_scope_or_clock');
  if(m.structureStrength!==2||s.input.candles.some(b=>!Number.isFinite(b.timestamp)||![b.high,b.low,b.close].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0)||b.low>b.close||b.close>b.high))return unknown('invalid_structure_bars_or_strength');
  const side=s.input.side,dir=side==='long'?1:side==='short'?-1:0;
  if(!dir||![m.entry,m.stopLoss,m.minSlFraction,m.minRr].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0))return unknown('invalid_recorded_geometry');
  const bars=closedCandlesOnly(s.input.candles,s.timeframe,m.asOf);
  if(!bars.length||bars.at(-1).timestamp!==m.structureCutoff)return unknown('structure_cutoff_conflict');
  const swings=findStructureSwings(bars,m.structureStrength);
  const targets=swings.filter(p=>p.kind===(side==='long'?'high':'low')&&dir*(p.price-m.entry)>0).sort((a,b)=>dir*(a.price-b.price));
  const target=targets[0],geometry=measurePlanGeometry({side,entry:m.entry,stopLoss:m.stopLoss,targetBound:target?.price,minSlFraction:m.minSlFraction,minRr:m.minRr});
  const targetMatches=(target?.price??null)===m.targetBound;
  const geometryMatches=JSON.stringify(geometry)===JSON.stringify(m.geometry);
  const advanced=events.filter(r=>r.event_data.trace_id===d.trace_id&&r.event_data.stage==='pre_ai_passed');
  return {event_id:e.id,trace_id:d.trace_id,status:targetMatches&&geometryMatches?'observed_diagnostic_reconciled':'mismatch',
   recorded_role:m.role,target_matches_recorded:targetMatches,geometry_matches_recorded:geometryMatches,geometry,
   target_evidence:target?{price:target.price,pivot_bar_open:bars[target.index].timestamp,confirmation_bar_open:bars[target.index+m.structureStrength]?.timestamp,timeframe:s.timeframe}:null,
   prior_closes_beyond_selected_target:target?bars.slice(target.index+m.structureStrength+1).filter(b=>dir*(b.close-target.price)>0).length:null,
   pre_ai_passed_records:advanced.length,
   full_structural_plan:null,missing_inputs:['original_signal_candle_series_for_entry_and_invalidation','independent_input_publication_lineage','target_liquidity_and_break_or_mitigation_lifecycle'],
   limits:'Recomputes nearest confirmed target and geometry from recorded inputs. Diagnostic target is not proven executable liquidity; missing original signal bars prevent full planner replay.'};
 });
 return {schema:'pre-ai-planning-assessment-v1',rows,full_planning_replay:'not_established',candidate_allowed:false,economic_roi:null};
}
module.exports = {assessCanonicalBaseline,reconcileObservedEquity,assessPreAiPlanning};

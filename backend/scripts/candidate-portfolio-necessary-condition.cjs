'use strict';

// Reject only a complete, valid modeled candidate. This can never authorize promotion.
function candidateNecessaryCondition(result, capital, end) {
  const d = result.diagnostics;
  if (result.status !== 'integration_window_completed' || result.last_evaluated_at !== Date.parse(end) || !result.terminal_export_complete ||
      !Array.isArray(result.terminal_command_gaps) || result.terminal_command_gaps.length || !d ||
      !['database_errors', 'adapter_failures', 'unavailable_dependencies'].every(k => Array.isArray(d[k]) && d[k].length === 0) || d.checkpoint_failure) {
    throw Error('candidate_complete_integrity_required_before_rejection');
  }
  const exchange = result.exchange;
  if (!Number.isFinite(capital) || capital <= 0 || !exchange || !Number.isFinite(exchange.equity) || !Array.isArray(exchange.orders) || !Array.isArray(exchange.fills) ||
      !Array.isArray(result.network_receipts) || !Array.isArray(result.receipt_replays)) {
    throw Error('candidate_economic_inputs_missing');
  }
  const orders = new Map(exchange.orders.map(o => [String(o.orderId), o]));
  if (orders.size !== exchange.orders.length || exchange.orders.some(o => o.orderId === undefined || !['OPEN', 'CLOSE'].includes(o.intent)) ||
      exchange.fills.some(f => !orders.has(String(f.orderId)) || !Number.isFinite(f.qty) || f.qty <= 0 ||
        !Number.isFinite(f.time) || !Number.isFinite(f.commission) || f.commission < 0)) throw Error('candidate_fill_order_lineage_missing');
  const entryIds = new Set(exchange.fills.filter(f => orders.get(String(f.orderId))?.intent === 'OPEN').map(f => String(f.orderId)));
  const costs = [...(result.network_receipts ?? []).map(r => r.response?.usage?.cost), ...(result.receipt_replays ?? []).map(r => r.reported_cost)];
  const unknownCosts = costs.filter(c => typeof c !== 'number' || !Number.isFinite(c) || c < 0).length;
  const knownCost = costs.filter(c => typeof c === 'number' && Number.isFinite(c) && c >= 0).reduce((s, c) => s + c, 0);
  if (!Number.isFinite(knownCost)) throw Error('candidate_cost_sum_not_finite');
  if (!result.provider_receipt_replay || !Array.isArray(result.provider_receipt_replay.used) ||
      result.provider_receipt_replay.used.length !== result.receipt_replays.length) throw Error('candidate_receipt_coverage_mismatch');
  const networkCost = result.network_receipts.map(r => r.response?.usage?.cost)
    .filter(c => typeof c === 'number' && Number.isFinite(c) && c >= 0).reduce((s, c) => s + c, 0);
  if (!Number.isFinite(result.new_reported_provider_cost_usd) || Math.abs(networkCost - result.new_reported_provider_cost_usd) > 1e-10) {
    throw Error('candidate_reported_invoice_cost_mismatch');
  }
  // Exchange equity already includes modeled execution fees, funding and price impact.
  const netUpperBound = exchange.equity - capital - knownCost;
  const reasons = [];
  if (entryIds.size === 0) reasons.push('zero_candidate_entry_orders_cannot_increase_independent_fills');
  if (netUpperBound <= 0) reasons.push('candidate_modeled_net_after_known_costs_nonpositive');
  return {
    status: 'full_candidate_necessary_condition_assessed',
    decision: reasons.length ? 'reject_registered_candidate' : 'matched_baseline_required',
    scope: 'shared-engine development model only; omitted nonnegative costs cannot improve its net',
    capital, marked_equity: exchange.equity, entry_order_ids: [...entryIds], entry_fills: entryIds.size,
    known_ai_operating_cost_usd: knownCost, unknown_cost_requests: unknownCosts, provider_cost_unknown: Boolean(result.provider_cost_unknown),
    modeled_net_after_known_costs_upper_bound_usd: netUpperBound,
    all_cost_roi_base: null, roi_stress: null, independent_quality_fill_uplift: null,
    failure_reasons: reasons, economic_goal_proven: false, promotion_allowed: false,
  };
}
module.exports = { candidateNecessaryCondition };

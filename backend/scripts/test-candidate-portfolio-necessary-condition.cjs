'use strict';
const assert = require('node:assert/strict');
const { candidateNecessaryCondition: assess } = require('./candidate-portfolio-necessary-condition.cjs');
const end = '2025-03-01T00:00:05Z';
function fixture() {
  return {
    status: 'integration_window_completed', last_evaluated_at: Date.parse(end), terminal_export_complete: true,
    terminal_command_gaps: [], diagnostics: { database_errors: [], adapter_failures: [], unavailable_dependencies: [] },
    exchange: { equity: 32, orders: [{ orderId: 1, intent: 'OPEN' }, { orderId: 2, intent: 'CLOSE' }],
      fills: [1, 1, 2].map(orderId => ({ orderId, qty: .001, time: Date.parse(end) - 1, commission: .1 })) },
    network_receipts: [{ response: { usage: { cost: .2 } } }], new_reported_provider_cost_usd: .2,
    receipt_replays: [{ reported_cost: .1 }], provider_receipt_replay: { used: [{}] },
  };
}
let r = fixture(), v = assess(r, 31, end);
assert.equal(v.entry_fills, 1); // Two executions of one entry are one entry order.
assert.ok(Math.abs(v.modeled_net_after_known_costs_upper_bound_usd - .7) < 1e-12); // Fees already in equity.
assert.equal(v.decision, 'matched_baseline_required');
assert.equal(v.promotion_allowed, false);
r = fixture(); r.exchange.equity = 31.2; assert.equal(assess(r, 31, end).decision, 'reject_registered_candidate');
r = fixture(); r.exchange.fills = [r.exchange.fills[2]]; assert.equal(assess(r, 31, end).decision, 'reject_registered_candidate');
r = fixture(); r.receipt_replays[0].reported_cost = null; v = assess(r, 31, end); assert.equal(v.unknown_cost_requests, 1); assert.equal(v.all_cost_roi_base, null);
r = fixture(); r.exchange.equity = 30; r.receipt_replays[0].reported_cost = null; assert.equal(assess(r, 31, end).decision, 'reject_registered_candidate');
r = fixture(); r.diagnostics.database_errors.push('broken'); assert.throws(() => assess(r, 31, end), /integrity_required/);
r = fixture(); r.status = 'failed'; assert.throws(() => assess(r, 31, end), /integrity_required/);
r = fixture(); r.exchange.fills[0].orderId = 3; assert.throws(() => assess(r, 31, end), /lineage_missing/);
r = fixture(); delete r.exchange.orders[0].intent; assert.throws(() => assess(r, 31, end), /lineage_missing/);
r = fixture(); r.exchange.orders.push(r.exchange.orders[0]); assert.throws(() => assess(r, 31, end), /lineage_missing/);
r = fixture(); delete r.receipt_replays; assert.throws(() => assess(r, 31, end), /inputs_missing/);
r = fixture(); r.provider_receipt_replay.used = []; assert.throws(() => assess(r, 31, end), /coverage_mismatch/);
r = fixture(); r.new_reported_provider_cost_usd = 0; assert.throws(() => assess(r, 31, end), /invoice_cost_mismatch/);
const actual = require('../../docs/audits/2026-10-08-serial-month-policy-v2/baseline-run/result.json');
assert.throws(() => assess(actual, 31.47744546, end), /integrity_required/); // Actual PG53100 is invalid, never a financial verdict.
console.log(JSON.stringify({ status: 'pass', economic_accounting_and_failure_cases: 14, actual_failed_run_refused: true, provider_calls: 0, economic_goal_proven: false }));

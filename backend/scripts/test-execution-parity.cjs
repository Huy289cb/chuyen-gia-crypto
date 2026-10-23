const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-parity-'));
const input = path.join(dir, 'input.json');
const output = path.join(dir, 'output.json');
fs.writeFileSync(input, JSON.stringify({
  schema: 'execution-parity-export-v1', since: '2026-01-01T00:00:00Z', through: '2026-01-02T00:00:00Z', malformed: 0,
  events: [
    { event_type: 'pending_order_linked', timestamp: '2026-01-01T00:00:00Z', event_data: { order_id: 'o', trace_id: 't', code_hash: 'c', policy_hash: 'p' } },
    { event_type: 'entry_order_filled', timestamp: '2026-01-01T00:01:00Z', event_data: { order_id: 'o', entry_price: 99, executed_qty: 1, timestamp: '2026-01-01T00:01:00Z', linkage_status: 'linked' } },
    { event_type: 'llm_provider_result', timestamp: '2026-01-01T00:00:00Z', event_data: { cost_usd: null } },
  ],
  orders: [{ order_id: 'o', side: 'long', entry_price: 100, size_qty: 1, created_at: '2026-01-01T00:00:00Z', binance_order_id: 'b' }],
  positions: [{ binance_order_id: 'b', entry_price: 99, size_qty: 1, entry_fee: .0198, exit_fee: .05, funding_fee: 0, realized_pnl: 1 }],
}));
const result = spawnSync(process.execPath, [path.resolve(__dirname, 'analyze-execution-parity.cjs'), input, output], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
const report = JSON.parse(fs.readFileSync(output));
assert.equal(report.rows[0].signedEntrySlippageUsd, -1);
assert.equal(report.entryExecution.totalActualObservableEntryCostUsd, -.9802);
assert(Math.abs(report.entryExecution.totalModeledStressEntryCostUsd - .15) < 1e-12);
assert.equal(report.counts.linkedFills, 1);
assert.equal(report.aiCost.unknownCostResults, 1);
console.log('PASS: direction-aware slippage, modeled costs, linkage, unknown AI cost');

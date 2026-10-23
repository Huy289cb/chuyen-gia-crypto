const fs = require('node:fs');
const crypto = require('node:crypto');

const [inputFile, outputFile] = process.argv.slice(2);
if (!inputFile || !outputFile) {
  throw new Error('Usage: node scripts/analyze-execution-parity.cjs LIVE_EXPORT.json NEW_REPORT.json');
}

const bytes = fs.readFileSync(inputFile);
const input = JSON.parse(bytes);
if (input.schema !== 'execution-parity-export-v1') throw new Error('Unsupported export schema');

const events = input.events.map((event) => ({
  ...event,
  timestampMs: Date.parse(event.timestamp),
  event_data: event.event_data ?? {},
}));
const byOrder = new Map();
for (const event of events) {
  const orderId = event.event_data.order_id;
  if (typeof orderId !== 'string') continue;
  const list = byOrder.get(orderId) ?? [];
  list.push(event);
  byOrder.set(orderId, list);
}
const positionsByBinanceOrder = new Map(input.positions.map((p) => [p.binance_order_id, p]));

const rows = input.orders.map((order) => {
  const linked = byOrder.get(order.order_id) ?? [];
  const fill = linked.find((e) => e.event_type === 'entry_order_filled');
  const link = linked.find((e) => e.event_type === 'pending_order_linked');
  const position = positionsByBinanceOrder.get(order.binance_order_id);
  const planned = Number(order.entry_price);
  const actual = Number(fill?.event_data.entry_price ?? position?.entry_price);
  const quantity = Number(fill?.event_data.executed_qty ?? position?.size_qty ?? order.size_qty);
  const direction = order.side === 'long' ? 1 : -1;
  const signedEntrySlippageUsd = Number.isFinite(actual)
    ? direction * (actual - planned) * quantity
    : null;
  const actualEntryFee = position ? Number(position.entry_fee) : null;
  const actualEntryFeeRate = position && actual > 0 && quantity > 0
    ? actualEntryFee / (actual * quantity)
    : null;
  const assumedBaseEntrySlip = planned * quantity * 0.001 / 2;
  const assumedStressEntrySlip = planned * quantity * 0.002 / 2;
  const assumedEntryFee = planned * quantity * 0.0005;
  const createdMs = Date.parse(order.created_at);
  const fillMs = fill
    ? Date.parse(String(fill.event_data.timestamp ?? fill.timestamp))
    : order.executed_at ? Date.parse(order.executed_at) : null;
  return {
    orderId: order.order_id,
    traceId: link?.event_data.trace_id ?? fill?.event_data.trace_id ?? null,
    codeHash: link?.event_data.code_hash ?? fill?.event_data.code_hash ?? null,
    policyHash: link?.event_data.policy_hash ?? fill?.event_data.policy_hash ?? null,
    side: order.side,
    plannedEntry: planned,
    actualEntry: Number.isFinite(actual) ? actual : null,
    quantity,
    entryPriceDelta: Number.isFinite(actual) ? actual - planned : null,
    signedEntrySlippageUsd,
    fillLatencySeconds: fillMs == null ? null : (fillMs - createdMs) / 1000,
    actualEntryFeeUsd: actualEntryFee,
    actualEntryFeeRate,
    modeledBaseEntryCostUsd: assumedEntryFee + assumedBaseEntrySlip,
    modeledStressEntryCostUsd: assumedEntryFee + assumedStressEntrySlip,
    actualObservableEntryCostUsd: actualEntryFee == null || signedEntrySlippageUsd == null
      ? null : actualEntryFee + signedEntrySlippageUsd,
    closePrice: position?.close_price ?? null,
    closeTime: position?.close_time ?? null,
    exitFeeUsd: position?.exit_fee ?? null,
    fundingFeeUsd: position?.funding_fee ?? null,
    realizedPnlUsd: position?.realized_pnl ?? null,
    linkageStatus: fill?.event_data.linkage_status ?? null,
  };
});

const filled = rows.filter((row) => row.actualEntry != null);
const sum = (values) => values.reduce((total, value) => total + value, 0);
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const finite = (values) => values.filter((value) => typeof value === 'number' && Number.isFinite(value));
const unknownAiCosts = events.filter((event) =>
  event.event_type === 'llm_provider_result' && event.event_data.cost_usd == null
).length;
const knownAiCosts = finite(events.filter((event) => event.event_type === 'llm_provider_result')
  .map((event) => event.event_data.cost_usd));

const report = {
  schema: 'execution-parity-analysis-v1',
  analyzedAt: new Date().toISOString(),
  inputSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  interval: { since: input.since, through: input.through },
  counts: {
    events: events.length,
    orders: input.orders.length,
    filledOrders: filled.length,
    positions: input.positions.length,
    malformedEvents: input.malformed,
    linkedFills: filled.filter((row) => row.linkageStatus === 'linked').length,
    distinctCodeHashes: new Set(filled.map((row) => row.codeHash).filter(Boolean)).size,
    distinctPolicyHashes: new Set(filled.map((row) => row.policyHash).filter(Boolean)).size,
  },
  entryExecution: {
    medianFillLatencySeconds: median(finite(filled.map((row) => row.fillLatencySeconds))),
    medianAbsolutePriceDelta: median(finite(filled.map((row) => Math.abs(row.entryPriceDelta)))),
    totalSignedEntrySlippageUsd: sum(finite(filled.map((row) => row.signedEntrySlippageUsd))),
    totalActualEntryFeesUsd: sum(finite(filled.map((row) => row.actualEntryFeeUsd))),
    medianActualEntryFeeRate: median(finite(filled.map((row) => row.actualEntryFeeRate))),
    totalActualObservableEntryCostUsd: sum(finite(filled.map((row) => row.actualObservableEntryCostUsd))),
    totalModeledBaseEntryCostUsd: sum(filled.map((row) => row.modeledBaseEntryCostUsd)),
    totalModeledStressEntryCostUsd: sum(filled.map((row) => row.modeledStressEntryCostUsd)),
  },
  outcomes: {
    closed: filled.filter((row) => row.realizedPnlUsd != null).length,
    realizedPnlUsd: sum(finite(filled.map((row) => row.realizedPnlUsd))),
    entryFeesUsd: sum(finite(filled.map((row) => row.actualEntryFeeUsd))),
    exitFeesUsd: sum(finite(filled.map((row) => row.exitFeeUsd))),
    fundingFeesUsd: sum(finite(filled.map((row) => row.fundingFeeUsd))),
  },
  aiCost: {
    providerResults: events.filter((event) => event.event_type === 'llm_provider_result').length,
    knownCostResults: knownAiCosts.length,
    knownCostUsd: sum(knownAiCosts),
    unknownCostResults: unknownAiCosts,
  },
  rows,
  limitations: [
    'DB-recorded fees and realized PnL are not independently reconciled against exchange userTrades in this read-only run.',
    'Three fills across two code/policy hashes are enough to expose accounting mismatch, not to estimate a stable slippage distribution.',
    'Entry limit price improvement is observed; exit slippage cannot be isolated from the stored close price and close reason alone.',
    'Unknown provider costs remain unknown and must not be treated as zero.',
  ],
};

fs.writeFileSync(outputFile, JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ counts: report.counts, entryExecution: report.entryExecution, outcomes: report.outcomes }));

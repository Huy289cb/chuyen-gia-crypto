import { parseBinancePositionRisk, type ParsedBinancePosition } from './binance-position-match';
import { classifyProtectiveCoverage, type ProtectiveAlgoLike } from './protective-coverage';
const object = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const time = (v: unknown) => typeof v === 'string' ? Date.parse(v) : NaN;
const number = (v: unknown): number | null => {
  if (typeof v !== 'number' && (typeof v !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v))) return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
};
const unknown = (reason: string) => ({ status: 'unknown' as const, reason });

/** Interpret each query at its own receipt time; never combine them into an atomic portfolio state. */
export function replayRecordedProtectionState(record: unknown, asOf: number) {
  const data = object(record);
  if (!Number.isFinite(asOf)) return unknown('invalid_cutoff');
  if (!data || data.schema !== 'protection-state-observation-v1' || data.symbol !== 'BTCUSDT') return unknown('unsupported_schema_or_symbol');
  const known = time(data.known_at);
  if (!Number.isFinite(known)) return unknown('missing_knowledge_time');
  if (known > asOf) return unknown('not_known_at_cutoff');
  const positions = object(data.positions), orders = object(data.orders);
  if (!positions || positions.status !== 'observed' || positions.endpoint !== '/fapi/v2/positionRisk' || !Array.isArray(positions.rows) || !positions.rows.length)
    return unknown('missing_position_query');
  const validClocks = (query: Record<string, unknown>) => {
    const started = time(query.started_at), received = time(query.received_at);
    return Number.isFinite(started) && Number.isFinite(received) && started <= received && received <= known;
  };
  if (!validClocks(positions)) return unknown('invalid_position_query_clocks');
  const seen = new Set<string>(), normalized: ParsedBinancePosition[] = [], quantities: {position_side: string; signed_quantity: number}[] = [];
  for (const raw of positions.rows) {
    const row = object(raw);
    if (!row || row.symbol !== 'BTCUSDT' || !['BOTH', 'LONG', 'SHORT'].includes(String(row.positionSide))) return unknown('invalid_position_identity');
    const side = String(row.positionSide), qty = number(row.positionAmt), entry = number(row.entryPrice), mark = number(row.markPrice);
    if (seen.has(side)) return unknown('duplicate_position_side'); seen.add(side);
    if (qty === null || entry === null || mark === null || entry < 0 || mark < 0 ||
        (qty !== 0 && entry <= 0) || (side === 'LONG' && qty < 0) || (side === 'SHORT' && qty > 0)) return unknown('invalid_position_numbers_or_side');
    quantities.push({position_side: side, signed_quantity: qty});
    if (qty !== 0) {
      const position = parseBinancePositionRisk({symbol: 'BTCUSDT', positionSide: side, positionAmt: qty, entryPrice: entry, markPrice: mark});
      // Shared parser uses its existing dust threshold; do not relabel nonzero dust as flat.
      if (!position) return unknown('nonzero_position_not_materializable');
      normalized.push(position);
    }
  }
  if (seen.has('BOTH') && seen.size > 1) return unknown('mixed_position_modes');
  let orderResult: {status: 'unknown'; reason: string} | {status: 'observed'; received_at: string; count: number; legacy_matching_ids: ReturnType<typeof classifyProtectiveCoverage>[]} = unknown('missing_order_query');
  if (orders?.status === 'observed' && orders.endpoint === '/fapi/v1/openAlgoOrders' && Array.isArray(orders.rows)) {
    if (!validClocks(orders)) orderResult = unknown('invalid_order_query_clocks');
    else {
      const rows = orders.rows.map(object);
      const ids = rows.map(row => row?.algoId ?? row?.orderId);
      if (rows.some(row => !row || row.symbol !== 'BTCUSDT') || ids.some(id => id == null || String(id) === '') || new Set(ids.map(String)).size !== ids.length)
        orderResult = unknown('invalid_or_duplicate_order_identity');
      else orderResult = { status: 'observed', received_at: String(orders.received_at), count: rows.length,
        legacy_matching_ids: normalized.map(position => classifyProtectiveCoverage(position, rows as unknown as ProtectiveAlgoLike[])) };
    }
  }
  return { status: 'observed' as const, known_at: new Date(known).toISOString(), position_received_at: String(positions.received_at), quantities,
    flat_at_position_query: quantities.every(row => row.signed_quantity === 0), open_positions: normalized, orders: orderResult,
    concurrent_protection: 'not_established' as const,
    limits: 'Separate query snapshots only. Legacy matching IDs do not validate trigger, quantity/close flags or simultaneous position protection; no fills or ledger transitions inferred.' };
}

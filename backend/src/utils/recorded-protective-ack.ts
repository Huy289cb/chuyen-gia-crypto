type Unknown = { status: 'unknown'; reason: string };
type Mismatch = { status: 'mismatch'; reason: string };
type Match = { status: 'receipt_contract_matches'; order_id: string; working_type: string; position_side: string;
  quantity: number | null; trigger_price: number; price_protect: boolean; current_protection: 'not_established' };
type Result = Unknown | Mismatch | Match;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const positive = (value: unknown): number | null => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))) return null;
  const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null;
};
const flag = (value: unknown): boolean | null => value === true || value === 'true' ? true : value === false || value === 'false' ? false : null;
const orderId = (value: unknown): string | null => typeof value === 'string' && /^[1-9]\d*$/.test(value) ? value :
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : null;

/** Receipt-time agreement only. A matching NEW ACK cannot prove an order is still active. */
export function replayRecordedProtectiveAcknowledgement(record: unknown, knownAt: number, asOf: number): Result {
  if (!Number.isFinite(knownAt) || !Number.isFinite(asOf)) return { status: 'unknown', reason: 'missing_knowledge_time' };
  if (knownAt > asOf) return { status: 'unknown', reason: 'not_known_at_cutoff' };
  const data = object(record);
  if (!data || data.acknowledgement_schema !== 'client-receipt-v1') return { status: 'unknown', reason: 'missing_receipt_schema' };
  const started = typeof data.request_started_at === 'string' ? Date.parse(data.request_started_at) : NaN;
  const received = typeof data.acknowledgement_received_at === 'string' ? Date.parse(data.acknowledgement_received_at) : NaN;
  if (!Number.isFinite(started) || !Number.isFinite(received) || started > received || received > knownAt)
    return { status: 'unknown', reason: 'invalid_receipt_clocks' };
  const evidence = object(data.algo_contract_evidence), request = object(evidence?.request), response = object(evidence?.response);
  if (evidence?.schema !== 'algo-contract-evidence-v1' || !request || !response)
    return { status: 'unknown', reason: 'missing_wire_evidence' };
  const type = data.protection_type === 'stop_loss' ? 'STOP_MARKET' : data.protection_type === 'take_profit' ? 'TAKE_PROFIT_MARKET' : null;
  if (!type || !['BUY', 'SELL'].includes(String(request.side)) || typeof request.symbol !== 'string' || !request.symbol)
    return { status: 'unknown', reason: 'invalid_request_identity' };
  if (request.type !== type || request.algoType !== 'CONDITIONAL' || data.symbol !== request.symbol || data.side !== request.side)
    return { status: 'mismatch', reason: 'request_receipt_identity_mismatch' };
  const id = orderId(response.algoId);
  if (!id || response.algoStatus == null || response.orderType == null || response.symbol == null || response.side == null || response.algoType == null)
    return { status: 'unknown', reason: 'missing_response_identity' };
  if (orderId(data.binance_order_id) !== id || response.orderType !== type || response.symbol !== request.symbol || response.side !== request.side || response.algoType !== 'CONDITIONAL')
    return { status: 'mismatch', reason: 'response_identity_mismatch' };
  if (response.algoStatus !== 'NEW') return { status: 'unknown', reason: 'non_new_receipt' };
  if (!['MARK_PRICE', 'CONTRACT_PRICE'].includes(String(response.workingType)) || !['BOTH', 'LONG', 'SHORT'].includes(String(response.positionSide)))
    return { status: 'unknown', reason: 'missing_response_trigger_or_position_mode' };
  if ((request.workingType != null && request.workingType !== response.workingType) ||
      (request.positionSide != null && request.positionSide !== response.positionSide))
    return { status: 'mismatch', reason: 'trigger_or_position_mode_mismatch' };
  const priceProtect = flag(response.priceProtect);
  if (priceProtect === null) return { status: 'unknown', reason: 'missing_price_protection_flag' };
  if (request.priceProtect != null && flag(request.priceProtect) !== priceProtect)
    return { status: 'mismatch', reason: 'price_protection_flag_mismatch' };
  const trigger = positive(request.triggerPrice), responseTrigger = positive(response.triggerPrice);
  if (trigger === null || responseTrigger === null) return { status: 'unknown', reason: 'missing_trigger_price' };
  if (trigger !== responseTrigger) return { status: 'mismatch', reason: 'trigger_price_mismatch' };
  const closeAll = flag(request.closePosition) === true;
  let quantity: number | null = null;
  if (closeAll) {
    if (request.quantity != null || request.reduceOnly != null) return { status: 'mismatch', reason: 'invalid_close_all_request' };
    if ((response.positionSide === 'LONG' && response.side === 'BUY') || (response.positionSide === 'SHORT' && response.side === 'SELL'))
      return { status: 'mismatch', reason: 'invalid_hedge_close_side' };
    if (flag(response.closePosition) !== true) return { status: 'unknown', reason: 'missing_close_all_confirmation' };
  } else {
    quantity = positive(request.quantity);
    const responseQuantity = positive(response.quantity);
    if (quantity === null || responseQuantity === null || flag(response.reduceOnly) === null || flag(response.closePosition) === null)
      return { status: 'unknown', reason: 'missing_quantity_or_close_flags' };
    if (response.positionSide !== 'BOTH') return { status: 'mismatch', reason: 'reduce_only_in_hedge_mode' };
    if (flag(request.reduceOnly) !== true) return { status: 'unknown', reason: 'unsupported_fixed_quantity_close_mode' };
    if (quantity !== responseQuantity || flag(response.reduceOnly) !== true || flag(response.closePosition) !== false)
      return { status: 'mismatch', reason: 'quantity_or_close_flags_mismatch' };
  }
  return { status: 'receipt_contract_matches', order_id: id, working_type: String(response.workingType), position_side: String(response.positionSide),
    quantity, trigger_price: responseTrigger, price_protect: priceProtect, current_protection: 'not_established' };
}

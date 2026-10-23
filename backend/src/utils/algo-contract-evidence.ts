const fields = ['algoId', 'orderId', 'clientAlgoId', 'clientOrderId', 'algoType', 'type', 'orderType', 'symbol', 'side',
  'positionSide', 'quantity', 'origQty', 'triggerPrice', 'stopPrice', 'workingType', 'closePosition', 'reduceOnly',
  'priceProtect', 'algoStatus', 'status', 'createTime', 'updateTime', 'triggerTime'] as const;

/** Preserve actual wire primitives only; missing fields remain null, without API-default inference. */
export function captureAlgoContractEvidence(request: unknown, response: unknown) {
  const capture = (value: unknown) => {
    const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return Object.fromEntries(fields.map(field => {
      const item = source[field];
      return [field, typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)) ||
        (typeof item === 'string' && item.length <= 256) ? item : null];
    }));
  };
  return { schema: 'algo-contract-evidence-v1', request: capture(request), response: capture(response) };
}

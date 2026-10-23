/** Worst planned stop loss including fees and an explicit slippage reserve (not a guaranteed max loss). */
export function computeExecutionRisk(input: {
  entry: number; stopLoss: number; quantity: number; balance: number;
  roundTripFeePercent?: number; slippagePercent?: number;
}) {
  const { entry, stopLoss, quantity, balance, roundTripFeePercent = 0.1, slippagePercent = 0.1 } = input;
  if (![entry, stopLoss, quantity, balance].every(v => Number.isFinite(v) && v > 0) ||
      ![roundTripFeePercent, slippagePercent].every(v => Number.isFinite(v) && v >= 0)) throw new Error('Invalid execution risk inputs');
  const priceRiskUsd = Math.abs(entry - stopLoss) * quantity;
  // Reserve fees on the larger leg; do not assume a limit entry earns maker rates.
  const feeReserveUsd = Math.max(entry, stopLoss) * quantity * roundTripFeePercent / 100;
  const slippageReserveUsd = entry * quantity * slippagePercent / 100;
  const totalRiskUsd = priceRiskUsd + feeReserveUsd + slippageReserveUsd;
  return { priceRiskUsd, feeReserveUsd, slippageReserveUsd, totalRiskUsd, riskPercent: totalRiskUsd / balance * 100 };
}

/** Fixed USD mode is explicit; otherwise retain the existing wallet-percent ceiling. */
export function resolveExecutionRiskCapUsd(input: {
  balance: number; maxRiskPercent: number; maxRiskUsd?: number | null;
}): number {
  if (!Number.isFinite(input.balance) || input.balance <= 0) return 0;
  if (input.maxRiskUsd != null && Number.isFinite(input.maxRiskUsd) && input.maxRiskUsd > 0) {
    return input.maxRiskUsd;
  }
  return Number.isFinite(input.maxRiskPercent) && input.maxRiskPercent > 0
    ? input.balance * input.maxRiskPercent / 100 : 0;
}

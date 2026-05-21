/**
 * Exchange quantity normalization shared by entry and close/reduce paths.
 */

export interface SymbolQuantityFilters {
  stepSize: number;
  tickSize: number;
  minQty: number;
  maxQty: number;
  minPrice: number;
  maxPrice: number;
  minNotional: number;
}

export function normalizeToStepSize(value: number, stepSize: number): number {
  if (!Number.isFinite(value) || value <= 0 || stepSize <= 0) {
    return 0;
  }
  const stepDecimals = stepSize.toString().split('.')[1]?.length || 0;
  const normalized = Math.floor(value / stepSize) * stepSize;
  return parseFloat(normalized.toFixed(stepDecimals));
}

export interface NormalizedQuantityResult {
  rawQty: number;
  normalizedQty: number;
  stepSize: number;
  minQty: number;
  valid: boolean;
  reason?: string;
}

export function evaluateNormalizedQuantity(
  quantity: number,
  filters: Pick<SymbolQuantityFilters, 'stepSize' | 'minQty'>
): NormalizedQuantityResult {
  const normalizedQty = normalizeToStepSize(quantity, filters.stepSize);
  if (normalizedQty <= 0) {
    return {
      rawQty: quantity,
      normalizedQty: 0,
      stepSize: filters.stepSize,
      minQty: filters.minQty,
      valid: false,
      reason: `Quantity ${quantity} normalized to 0 (stepSize ${filters.stepSize})`,
    };
  }
  if (normalizedQty < filters.minQty) {
    return {
      rawQty: quantity,
      normalizedQty,
      stepSize: filters.stepSize,
      minQty: filters.minQty,
      valid: false,
      reason: `Quantity ${normalizedQty} below minQty ${filters.minQty} (raw ${quantity})`,
    };
  }
  return {
    rawQty: quantity,
    normalizedQty,
    stepSize: filters.stepSize,
    minQty: filters.minQty,
    valid: true,
  };
}

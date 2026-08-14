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

export function ceilToStepSize(value: number, stepSize: number): number {
  if (!Number.isFinite(value) || value <= 0 || stepSize <= 0) {
    return 0;
  }
  const stepDecimals = stepSize.toString().split('.')[1]?.length || 0;
  const normalized = Math.ceil(value / stepSize) * stepSize;
  return parseFloat(normalized.toFixed(stepDecimals));
}

export interface ResolveQuantityForMinNotionalInput {
  quantity: number;
  entryPrice: number;
  minNotionalUsd: number;
  stepSize: number;
  minQty: number;
  maxNotionalUsd?: number;
  tolerancePercent?: number;
}

export interface ResolveQuantityForMinNotionalResult {
  valid: boolean;
  normalizedQty: number;
  orderNotional: number;
  reason?: string;
}

/**
 * Floor to step when it still satisfies the configured notional tolerance.
 * When the requested size is below one exchange lot, raise it to the smallest
 * valid quantity; the caller must still enforce exposure and effective-risk caps.
 */
export function resolveQuantityForMinNotional(
  input: ResolveQuantityForMinNotionalInput
): ResolveQuantityForMinNotionalResult {
  const {
    quantity,
    entryPrice,
    minNotionalUsd,
    stepSize,
    minQty,
    maxNotionalUsd,
    tolerancePercent = 5,
  } = input;

  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return {
      valid: false,
      normalizedQty: 0,
      orderNotional: 0,
      reason: 'Invalid entry price',
    };
  }

  const minFloor = minNotionalUsd * (1 - tolerancePercent / 100);
  let normalizedQty = normalizeToStepSize(quantity, stepSize);
  let orderNotional = normalizedQty * entryPrice;

  if (normalizedQty < minQty || orderNotional < minFloor) {
    const minQtyForNotional = ceilToStepSize(minNotionalUsd / entryPrice, stepSize);
    normalizedQty = Math.max(minQty, minQtyForNotional);
    orderNotional = normalizedQty * entryPrice;
  }

  if (normalizedQty <= 0) {
    return {
      valid: false,
      normalizedQty: 0,
      orderNotional: 0,
      reason: `Quantity ${quantity} cannot satisfy minQty ${minQty} (stepSize ${stepSize})`,
    };
  }

  if (orderNotional < minFloor) {
    return {
      valid: false,
      normalizedQty,
      orderNotional,
      reason: `Order notional $${orderNotional.toFixed(0)} well below minimum $${minNotionalUsd} (tolerance ${tolerancePercent}%)`,
    };
  }

  if (maxNotionalUsd !== undefined) {
    const maxCeiling = maxNotionalUsd * (1 + tolerancePercent / 100);
    if (orderNotional > maxCeiling) {
      return {
        valid: false,
        normalizedQty,
        orderNotional,
        reason: `Order notional $${orderNotional.toFixed(0)} exceeds remaining capacity $${maxNotionalUsd.toFixed(0)} (tolerance ${tolerancePercent}%)`,
      };
    }
  }

  return { valid: true, normalizedQty, orderNotional };
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

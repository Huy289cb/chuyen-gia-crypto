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
export declare function normalizeToStepSize(value: number, stepSize: number): number;
export declare function ceilToStepSize(value: number, stepSize: number): number;
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
export declare function resolveQuantityForMinNotional(input: ResolveQuantityForMinNotionalInput): ResolveQuantityForMinNotionalResult;
export interface NormalizedQuantityResult {
    rawQty: number;
    normalizedQty: number;
    stepSize: number;
    minQty: number;
    valid: boolean;
    reason?: string;
}
export declare function evaluateNormalizedQuantity(quantity: number, filters: Pick<SymbolQuantityFilters, 'stepSize' | 'minQty'>): NormalizedQuantityResult;
//# sourceMappingURL=order-quantity.d.ts.map
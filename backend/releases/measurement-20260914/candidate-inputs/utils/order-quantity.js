"use strict";
/**
 * Exchange quantity normalization shared by entry and close/reduce paths.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeToStepSize = normalizeToStepSize;
exports.ceilToStepSize = ceilToStepSize;
exports.resolveQuantityForMinNotional = resolveQuantityForMinNotional;
exports.evaluateNormalizedQuantity = evaluateNormalizedQuantity;
function normalizeToStepSize(value, stepSize) {
    if (!Number.isFinite(value) || value <= 0 || stepSize <= 0) {
        return 0;
    }
    const stepDecimals = stepSize.toString().split('.')[1]?.length || 0;
    const normalized = Math.floor(value / stepSize) * stepSize;
    return parseFloat(normalized.toFixed(stepDecimals));
}
function ceilToStepSize(value, stepSize) {
    if (!Number.isFinite(value) || value <= 0 || stepSize <= 0) {
        return 0;
    }
    const stepDecimals = stepSize.toString().split('.')[1]?.length || 0;
    const normalized = Math.ceil(value / stepSize) * stepSize;
    return parseFloat(normalized.toFixed(stepDecimals));
}
/**
 * Floor to step when it still satisfies the configured notional tolerance.
 * When the requested size is below one exchange lot, raise it to the smallest
 * valid quantity; the caller must still enforce exposure and effective-risk caps.
 */
function resolveQuantityForMinNotional(input) {
    const { quantity, entryPrice, minNotionalUsd, stepSize, minQty, maxNotionalUsd, tolerancePercent = 5, } = input;
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
        return {
            valid: false,
            normalizedQty: 0,
            orderNotional: 0,
            code: 'missing_data',
            reason: 'Invalid entry price',
        };
    }
    if (![stepSize, minQty, minNotionalUsd].every(v => Number.isFinite(v) && v > 0) ||
        !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(tolerancePercent) || tolerancePercent < 0 || tolerancePercent >= 100 ||
        (maxNotionalUsd !== undefined && (!Number.isFinite(maxNotionalUsd) || maxNotionalUsd < 0))) {
        return { valid: false, normalizedQty: 0, orderNotional: 0, code: 'missing_data', reason: 'Invalid quantity, filters or exposure data' };
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
            code: 'min_lot',
            reason: `Quantity ${quantity} cannot satisfy minQty ${minQty} (stepSize ${stepSize})`,
        };
    }
    if (orderNotional < minFloor) {
        return {
            valid: false,
            normalizedQty,
            orderNotional,
            code: 'min_notional',
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
                code: 'exposure',
                reason: `Order notional $${orderNotional.toFixed(0)} exceeds remaining capacity $${maxNotionalUsd.toFixed(0)} (tolerance ${tolerancePercent}%)`,
            };
        }
    }
    return { valid: true, normalizedQty, orderNotional };
}
function evaluateNormalizedQuantity(quantity, filters) {
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
//# sourceMappingURL=order-quantity.js.map
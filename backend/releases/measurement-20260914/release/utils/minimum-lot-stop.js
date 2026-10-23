"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeMinimumLotStop = normalizeMinimumLotStop;
const trade_levels_1 = require("./trade-levels");
function validPositive(value) {
    return Number.isFinite(value) && value > 0;
}
function roundStopInsideRiskCap(action, entry, distancePct, tickSize) {
    const raw = action === 'buy' ? entry * (1 - distancePct) : entry * (1 + distancePct);
    const decimals = tickSize.toString().split('.')[1]?.length ?? 0;
    // Round toward entry so exchange price precision cannot push risk over cap.
    const ticks = action === 'buy' ? Math.ceil(raw / tickSize) : Math.floor(raw / tickSize);
    return Number((ticks * tickSize).toFixed(decimals));
}
function targetAtMinimumRr(action, entry, stopLoss, minRr, tickSize) {
    const risk = Math.abs(entry - stopLoss);
    const raw = action === 'buy' ? entry + risk * minRr : entry - risk * minRr;
    const decimals = tickSize.toString().split('.')[1]?.length ?? 0;
    // Round reward outward so price-derived R:R never falls below policy.
    const ticks = action === 'buy' ? Math.ceil(raw / tickSize) : Math.floor(raw / tickSize);
    return Number((ticks * tickSize).toFixed(decimals));
}
/**
 * Tighten a stop only when an exchange minimum lot would otherwise breach the
 * effective wallet-risk ceiling. The result is valid only when a cent-rounded
 * stop exists between the configured minimum SL and the cap-derived maximum.
 */
function normalizeMinimumLotStop(input) {
    const { action, entry, stopLoss, takeProfit, orderQty, balance, minSlPct, maxEffectiveRiskPct, minRr, preferredMaxSlPct, priceTickSize = 0.01, } = input;
    if (!validPositive(entry) ||
        !validPositive(stopLoss) ||
        !validPositive(takeProfit) ||
        !validPositive(orderQty) ||
        !validPositive(balance) ||
        !validPositive(minSlPct) ||
        !validPositive(maxEffectiveRiskPct) ||
        !validPositive(minRr) ||
        (preferredMaxSlPct != null && !validPositive(preferredMaxSlPct)) ||
        !validPositive(priceTickSize)) {
        return null;
    }
    if ((action === 'buy' && !(stopLoss < entry && takeProfit > entry)) ||
        (action === 'sell' && !(stopLoss > entry && takeProfit < entry))) {
        return null;
    }
    const orderNotional = orderQty * entry;
    const originalStopPct = Math.abs(entry - stopLoss) / entry;
    const originalRiskPct = (orderNotional * originalStopPct / balance) * 100;
    const maxFeasibleStopPct = (balance * (maxEffectiveRiskPct / 100)) / orderNotional;
    if (originalRiskPct <= maxEffectiveRiskPct + 1e-9) {
        return {
            adjusted: false,
            stopLoss,
            takeProfit,
            originalStopPct,
            normalizedStopPct: originalStopPct,
            maxFeasibleStopPct,
            effectiveRiskPct: originalRiskPct,
            expectedRr: (0, trade_levels_1.computeExpectedRrFromPrices)(entry, stopLoss, takeProfit) ?? 0,
            reason: 'original stop already fits effective-risk cap',
        };
    }
    if (maxFeasibleStopPct < minSlPct - 1e-9)
        return null;
    const selectedStopPct = Math.min(maxFeasibleStopPct, preferredMaxSlPct ?? maxFeasibleStopPct);
    if (selectedStopPct < minSlPct - 1e-9)
        return null;
    const normalizedStop = roundStopInsideRiskCap(action, entry, selectedStopPct, priceTickSize);
    const normalizedStopPct = Math.abs(entry - normalizedStop) / entry;
    if (normalizedStopPct < minSlPct - 1e-6 ||
        normalizedStopPct > selectedStopPct + 1e-9) {
        return null;
    }
    const normalizedTarget = targetAtMinimumRr(action, entry, normalizedStop, minRr, priceTickSize);
    const expectedRr = (0, trade_levels_1.computeExpectedRrFromPrices)(entry, normalizedStop, normalizedTarget) ?? 0;
    if (expectedRr + 1e-9 < minRr)
        return null;
    const effectiveRiskPct = (orderNotional * normalizedStopPct / balance) * 100;
    if (effectiveRiskPct > maxEffectiveRiskPct + 1e-9)
        return null;
    return {
        adjusted: true,
        stopLoss: normalizedStop,
        takeProfit: normalizedTarget,
        originalStopPct,
        normalizedStopPct,
        maxFeasibleStopPct,
        effectiveRiskPct,
        expectedRr,
        reason: `minimum-lot stop normalized ${(originalStopPct * 100).toFixed(2)}%→` +
            `${(normalizedStopPct * 100).toFixed(2)}% within cap ${maxEffectiveRiskPct.toFixed(2)}%`,
    };
}
//# sourceMappingURL=minimum-lot-stop.js.map
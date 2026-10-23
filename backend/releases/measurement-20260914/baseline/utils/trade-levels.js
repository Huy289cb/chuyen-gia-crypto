"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_SL_DISTANCE_EPS_RATIO = void 0;
exports.computeExpectedRrFromPrices = computeExpectedRrFromPrices;
exports.formatPriceLevel = formatPriceLevel;
exports.formatLlmTradeSummary = formatLlmTradeSummary;
exports.computePolicyCompliantStopAndTarget = computePolicyCompliantStopAndTarget;
exports.computeMinTakeProfitForRr = computeMinTakeProfitForRr;
exports.checkMinSlDistance = checkMinSlDistance;
exports.reconcileExpectedRr = reconcileExpectedRr;
/**
 * Risk:reward from entry / stop / target prices (reward ÷ risk).
 */
function computeExpectedRrFromPrices(entry, stopLoss, takeProfit) {
    if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || !Number.isFinite(takeProfit)) {
        return null;
    }
    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(takeProfit - entry);
    if (risk <= 0)
        return null;
    return reward / risk;
}
/**
 * Overwrite expected_rr with price-derived R:R; warn when LLM claim diverges.
 */
function formatPriceLevel(value) {
    if (value == null || !Number.isFinite(Number(value)))
        return '—';
    return Number(value).toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
}
/** One-line summary for event log / trade_decisions */
function formatLlmTradeSummary(analysis) {
    const action = String(analysis.action ?? '—');
    const conf = analysis.confidence != null && Number.isFinite(analysis.confidence)
        ? `${(analysis.confidence * 100).toFixed(0)}%`
        : '—';
    return [
        `LLM: ${action}`,
        `conf ${conf}`,
        `entry ${formatPriceLevel(analysis.suggested_entry)}`,
        `SL ${formatPriceLevel(analysis.suggested_stop_loss)}`,
        `TP ${formatPriceLevel(analysis.suggested_take_profit)}`,
    ].join(' · ');
}
/**
 * Minimum-distance SL + TP at min R:R from entry (policy math — does not rely on LLM arithmetic).
 */
function computePolicyCompliantStopAndTarget(input) {
    const { action, entry, minSlPct, minRr } = input;
    if (!Number.isFinite(entry) || entry <= 0 || minSlPct <= 0 || minRr <= 0)
        return null;
    if (action === 'buy') {
        const stopLoss = Math.floor(entry * (1 - minSlPct) * 100) / 100;
        const risk = entry - stopLoss;
        if (risk <= 0)
            return null;
        // Round outward: nearest-cent rounding can make the executor reject RR1.49999 < RR1.5.
        const takeProfit = Math.ceil((entry + risk * minRr) * 100) / 100;
        if (takeProfit <= entry)
            return null;
        return { stopLoss, takeProfit };
    }
    const stopLoss = Math.ceil(entry * (1 + minSlPct) * 100) / 100;
    const risk = stopLoss - entry;
    if (risk <= 0)
        return null;
    const takeProfit = Math.floor((entry - risk * minRr) * 100) / 100;
    if (takeProfit >= entry)
        return null;
    return { stopLoss, takeProfit };
}
/** Minimum TP price for a fixed entry/SL to satisfy min R:R (reward/risk). */
function computeMinTakeProfitForRr(input) {
    const { action, entry, stopLoss, minRr } = input;
    const risk = Math.abs(entry - stopLoss);
    if (!Number.isFinite(entry) || risk <= 0 || minRr <= 0)
        return null;
    if (action === 'buy') {
        const tp = Math.round((entry + risk * minRr) * 100) / 100;
        return tp > entry ? tp : null;
    }
    const tp = Math.round((entry - risk * minRr) * 100) / 100;
    return tp < entry ? tp : null;
}
/** Cent-rounded prices + IEEE float can sit ~1 ULP below policy min (e.g. 0.80% → 0.799999…). */
exports.MIN_SL_DISTANCE_EPS_RATIO = 1e-6;
function checkMinSlDistance(entry, stopLoss, minPct) {
    const distancePct = Math.abs(entry - stopLoss) / entry;
    return {
        ok: distancePct >= minPct - exports.MIN_SL_DISTANCE_EPS_RATIO,
        distancePct,
        minPct,
    };
}
function reconcileExpectedRr(analysis) {
    const entry = Number(analysis.suggested_entry);
    const sl = Number(analysis.suggested_stop_loss);
    const tp = Number(analysis.suggested_take_profit);
    const llmClaimedRr = analysis.expected_rr != null && Number.isFinite(Number(analysis.expected_rr))
        ? Number(analysis.expected_rr)
        : null;
    const computedRr = computeExpectedRrFromPrices(entry, sl, tp);
    if (computedRr == null) {
        return { analysis, computedRr: null, llmClaimedRr, rrCorrected: false };
    }
    const rounded = Math.round(computedRr * 100) / 100;
    let rrCorrected = false;
    if (llmClaimedRr == null || Math.abs(llmClaimedRr - rounded) > 0.15) {
        if (llmClaimedRr != null && llmClaimedRr > 0) {
            console.warn(`[TradeLevels] LLM expected_rr=${llmClaimedRr} corrected to ${rounded} ` +
                `(entry=${entry} sl=${sl} tp=${tp})`);
        }
        rrCorrected = llmClaimedRr != null && Math.abs(llmClaimedRr - rounded) > 0.15;
    }
    return {
        analysis: { ...analysis, expected_rr: rounded },
        computedRr: rounded,
        llmClaimedRr,
        rrCorrected,
    };
}
//# sourceMappingURL=trade-levels.js.map
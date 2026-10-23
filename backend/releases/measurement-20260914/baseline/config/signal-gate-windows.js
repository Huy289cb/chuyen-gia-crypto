"use strict";
/**
 * Per-timeframe lookback windows for setup gate (wall-clock aligned to ~15m baseline).
 * 5m uses more bars so sweep/regime see a similar time span as 15m/1h.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSignalGateWindows = getSignalGateWindows;
exports.getSignalGateCandleLimit = getSignalGateCandleLimit;
const WINDOWS_15M = {
    regimeBars: 50,
    sweepPriorBars: 19,
    breakoutBars: 30,
    minCandles: 50,
};
/** ~6h regime, ~4h sweep, ~4h consolidation — within 120-bar fetch. */
const WINDOWS_5M = {
    regimeBars: 72,
    sweepPriorBars: 48,
    breakoutBars: 48,
    minCandles: 50,
};
const WINDOWS_1H = {
    regimeBars: 50,
    sweepPriorBars: 19,
    breakoutBars: 30,
    minCandles: 50,
};
function getSignalGateWindows(timeframe) {
    switch (timeframe) {
        case '5m':
            return WINDOWS_5M;
        case '1h':
            return WINDOWS_1H;
        case '15m':
        default:
            return WINDOWS_15M;
    }
}
/** Candle fetch limit — 5m needs more history for scaled windows. */
function getSignalGateCandleLimit(timeframe) {
    const w = getSignalGateWindows(timeframe);
    return Math.max(100, w.regimeBars + 10, w.breakoutBars + 5);
}
//# sourceMappingURL=signal-gate-windows.js.map
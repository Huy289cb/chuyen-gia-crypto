"use strict";
/**
 * Helpers for hard gates that must only consume completed OHLCV bars.
 * Unified candle timestamps are Binance bar-open times.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CLOSED_CANDLE_GRACE_MS = void 0;
exports.getClosedCandleFinalizationGraceMs = getClosedCandleFinalizationGraceMs;
exports.closedCandlesOnly = closedCandlesOnly;
const TIMEFRAME_MS = {
    '1m': 60_000,
    '5m': 5 * 60_000,
    '15m': 15 * 60_000,
    '1h': 60 * 60_000,
    '4h': 4 * 60 * 60_000,
    '1d': 24 * 60 * 60_000,
};
/**
 * Binance can briefly return a still-mutating kline at the exact close boundary.
 * Keep a small finalization buffer so scanners never consume that transient OHLC.
 */
exports.DEFAULT_CLOSED_CANDLE_GRACE_MS = 5_000;
function getClosedCandleFinalizationGraceMs() {
    const raw = process.env.CLOSED_CANDLE_FINALIZATION_GRACE_MS?.trim();
    if (!raw)
        return exports.DEFAULT_CLOSED_CANDLE_GRACE_MS;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : exports.DEFAULT_CLOSED_CANDLE_GRACE_MS;
}
/**
 * Return only bars whose full timeframe elapsed by `nowMs`.
 * Unknown timeframes fail closed instead of treating an active bar as complete.
 */
function closedCandlesOnly(candles, timeframe, nowMs = Date.now(), graceMs = getClosedCandleFinalizationGraceMs()) {
    const timeframeMs = TIMEFRAME_MS[timeframe.toLowerCase()];
    if (!timeframeMs || !Number.isFinite(nowMs) || !Number.isFinite(graceMs) || graceMs < 0) {
        return [];
    }
    return candles.filter((candle) => Number.isFinite(candle.timestamp) && candle.timestamp + timeframeMs + graceMs <= nowMs);
}
//# sourceMappingURL=closed-candles.js.map
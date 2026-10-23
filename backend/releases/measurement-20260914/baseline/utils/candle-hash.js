"use strict";
/**
 * Deterministic candle-bar identity for signal cache and trade_decisions dedup.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCandleHash = void 0;
exports.generateCandleBarKey = generateCandleBarKey;
/**
 * Stable identity for one exchange bar. OHLC is deliberately excluded because
 * Binance may revise the just-closed payload for a few seconds after boundary.
 */
function generateCandleBarKey(candles) {
    if (!candles.length) {
        return 'empty';
    }
    const last = candles[candles.length - 1];
    const ts = last.timestamp instanceof Date ? last.timestamp.getTime() : Number(last.timestamp);
    return Number.isFinite(ts) ? `bar:v2:${ts}` : 'empty';
}
/** @deprecated Kept for compatibility; this now returns the stable bar key. */
exports.generateCandleHash = generateCandleBarKey;
//# sourceMappingURL=candle-hash.js.map
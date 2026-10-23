/**
 * Deterministic candle-bar identity for signal cache and trade_decisions dedup.
 */
export interface CandleHashInput {
    timestamp: number | Date;
    high?: number;
    low?: number;
    close?: number;
}
/**
 * Stable identity for one exchange bar. OHLC is deliberately excluded because
 * Binance may revise the just-closed payload for a few seconds after boundary.
 */
export declare function generateCandleBarKey(candles: CandleHashInput[]): string;
/** @deprecated Kept for compatibility; this now returns the stable bar key. */
export declare const generateCandleHash: typeof generateCandleBarKey;
//# sourceMappingURL=candle-hash.d.ts.map
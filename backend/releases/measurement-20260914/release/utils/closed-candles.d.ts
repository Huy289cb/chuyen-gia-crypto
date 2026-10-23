/**
 * Helpers for hard gates that must only consume completed OHLCV bars.
 * Unified candle timestamps are Binance bar-open times.
 */
/**
 * Binance can briefly return a still-mutating kline at the exact close boundary.
 * Keep a small finalization buffer so scanners never consume that transient OHLC.
 */
export declare const DEFAULT_CLOSED_CANDLE_GRACE_MS = 5000;
export declare function getClosedCandleFinalizationGraceMs(): number;
/**
 * Return only bars whose full timeframe elapsed by `nowMs`.
 * Unknown timeframes fail closed instead of treating an active bar as complete.
 */
export declare function closedCandlesOnly<T extends {
    timestamp: number;
}>(candles: readonly T[], timeframe: string, nowMs?: number, graceMs?: number): T[];
//# sourceMappingURL=closed-candles.d.ts.map
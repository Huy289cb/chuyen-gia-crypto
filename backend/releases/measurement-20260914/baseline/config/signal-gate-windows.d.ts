/**
 * Per-timeframe lookback windows for setup gate (wall-clock aligned to ~15m baseline).
 * 5m uses more bars so sweep/regime see a similar time span as 15m/1h.
 */
export interface SignalGateWindows {
    /** Bars for regime regression (last N). */
    regimeBars: number;
    /** Prior bars before current for liquidity sweep (excludes current). */
    sweepPriorBars: number;
    /** Total bars for breakout (includes current). */
    breakoutBars: number;
    minCandles: number;
}
export declare function getSignalGateWindows(timeframe: string): SignalGateWindows;
/** Candle fetch limit — 5m needs more history for scaled windows. */
export declare function getSignalGateCandleLimit(timeframe: string): number;
//# sourceMappingURL=signal-gate-windows.d.ts.map
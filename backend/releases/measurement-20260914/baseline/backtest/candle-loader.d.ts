import type { BacktestCandle } from './types';
/** Binance kline timestamps are candle open times. */
export declare function timeframeDurationMs(timeframe: string): number;
export declare function candleCloseTimestamp(candle: BacktestCandle, timeframe: string): number;
/**
 * Return only candles that were fully closed at decision time.
 * Optional `limit` mirrors production's bounded lookback (for example structure=120).
 */
export declare function closedCandlesUpTo(candles: BacktestCandle[], decisionTs: number, timeframe: string, limit?: number): BacktestCandle[];
export declare function warmupStartTimestamp(periodStartTs: number, timeframe: string, warmupBars: number): number;
export declare function estimateBarsForWeeks(timeframe: string, weeks: number): number;
export interface LoadedBacktestCandles {
    byTf: Record<string, BacktestCandle[]>;
    period: {
        start: Date;
        end: Date;
    };
}
/**
 * Load OHLCV for backtest window + warmup from Binance Futures.
 */
export declare function loadBacktestCandles(input: {
    symbol: string;
    weeks: number;
    timeframes: string[];
    startDate?: Date;
    endDate?: Date;
    extraWarmupBarsPerTf?: number;
    /** @deprecated Use extraWarmupBarsPerTf. Kept for callers from the original testbed. */
    extraWarmupBars5m?: number;
}): Promise<LoadedBacktestCandles>;
//# sourceMappingURL=candle-loader.d.ts.map
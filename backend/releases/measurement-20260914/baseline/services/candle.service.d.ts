/**
 * Unified candle source: Binance klines first, DB cache as fallback.
 * Used by market routes, signal gate, market scan, and LLM input.
 */
export interface UnifiedCandle {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    /** Unix ms (bar open time) */
    timestamp: number;
}
export type CandleSource = 'binance' | 'database';
export interface GetCandlesOptions {
    symbol: string;
    timeframe: string;
    limit?: number;
    /** When true, persist freshly fetched Binance bars to DB */
    cacheToDb?: boolean;
}
export interface GetCandlesResult {
    candles: UnifiedCandle[];
    source: CandleSource;
}
/**
 * Fetch candles: Binance when available, otherwise validated DB cache.
 */
export declare function getCandles(options: GetCandlesOptions): Promise<GetCandlesResult>;
/** Chart API shape (UTC seconds). */
export declare function toChartCandles(candles: UnifiedCandle[]): {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}[];
//# sourceMappingURL=candle.service.d.ts.map
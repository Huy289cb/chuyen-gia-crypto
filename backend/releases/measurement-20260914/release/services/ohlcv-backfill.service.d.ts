/**
 * Backfill OHLCV from Binance history when DB warmup count is below target.
 */
export interface OhlcvBackfillTfResult {
    timeframe: string;
    before: number;
    after: number;
    fetched: number;
    saved: number;
    skipped: boolean;
}
export interface OhlcvBackfillResult {
    symbol: string;
    timeframes: OhlcvBackfillTfResult[];
}
/**
 * Pull historical klines from Binance and upsert into DB until targetCount rows exist.
 */
export declare function backfillOhlcvTimeframe(symbol: string, timeframe: string, targetCount: number): Promise<OhlcvBackfillTfResult>;
/** Backfill all V3 gate TFs that are below warmup targets. */
export declare function backfillOhlcvIfNeeded(symbol?: string): Promise<OhlcvBackfillResult>;
export declare function isOhlcvBackfillOnStartEnabled(): boolean;
//# sourceMappingURL=ohlcv-backfill.service.d.ts.map
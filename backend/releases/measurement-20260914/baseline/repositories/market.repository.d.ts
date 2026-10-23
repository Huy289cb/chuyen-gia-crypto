/**
 * Market Data Repository
 *
 * Handles all database operations for OHLCV candles, latest prices, and price history
 */
export interface OhlcvCandleData {
    coin: string;
    timestamp: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    timeframe?: string;
}
export interface LatestPriceData {
    coin: string;
    price: number;
    change24h?: number;
    change7d?: number;
    marketCap?: number;
    volume24h?: number;
}
/**
 * Save or update OHLCV candle
 */
export declare function saveOhlcvCandle(data: OhlcvCandleData): Promise<number>;
export interface SaveOhlcvBatchOptions {
    /** Persist only the newest N bars (default: all). Market scan should pass 2–3. */
    maxBars?: number;
}
/**
 * Batch save OHLCV candles (sequential upserts; keep maxBars small for DB load).
 */
export declare function saveOhlcvCandlesBatch(candles: OhlcvCandleData[], options?: SaveOhlcvBatchOptions): Promise<number>;
/** Count stored bars for warmup progress / backfill checks. */
export declare function countOhlcvCandles(coin: string, timeframe: string): Promise<number>;
/**
 * Get OHLCV candles for a time range
 */
export declare function getOhlcvCandles(coin: string, hoursBack?: number, timeframe?: string): Promise<any[]>;
/**
 * Get latest OHLCV candle
 */
export declare function getLatestOhlcvCandle(coin: string, timeframe?: string): Promise<any | null>;
/**
 * Save latest price
 */
export declare function saveLatestPrice(data: LatestPriceData): Promise<number>;
/**
 * Get latest price
 */
export declare function getLatestPrice(coin: string): Promise<any | null>;
/**
 * Get all latest prices
 */
export declare function getAllLatestPrices(): Promise<any[]>;
/**
 * Save price history entry
 */
export declare function savePriceHistory(coin: string, price: number): Promise<number>;
/**
 * Get price history
 */
export declare function getPriceHistory(coin: string, hoursBack?: number): Promise<any[]>;
//# sourceMappingURL=market.repository.d.ts.map
/**
 * Price Fetcher Service (TypeScript)
 *
 * Primary source: Binance USD-M Futures (BINANCE_BASE_URL — demo-fapi or fapi)
 * Secondary source: Database OHLCV candles
 */
export interface CandleData {
    price: number;
    open: number;
    high: number;
    low: number;
    volume: number;
    time: string;
}
export interface PriceData {
    timestamp: string;
    btc: CandleData;
    eth?: CandleData;
}
/**
 * Fetch real-time 1-minute candle data from Binance USD-M Futures.
 */
export declare function fetchRealTimePrices(): Promise<PriceData>;
/**
 * Fetch prices from database (fallback for analysis)
 */
export declare function fetchPricesFromDb(coin?: string): Promise<CandleData | null>;
/**
 * Fetch historical OHLCV candles from Binance USD-M Futures.
 */
export declare function fetchHistoricalCandles(symbol: string, interval?: string, limit?: number): Promise<number[][]>;
/**
 * Fetch up to totalLimit historical klines from Binance Futures (paginated backwards).
 * When `endTimeExclusiveMs` is provided, pagination is anchored strictly before that
 * timestamp instead of implicitly ending at the current Binance server time.
 * Returns ascending rows: [openTime, open, high, low, close, volume, ...].
 */
export declare function fetchHistoricalCandlesPaginated(symbol: string, interval: string, totalLimit: number, endTimeExclusiveMs?: number): Promise<number[][]>;
/**
 * Fetch prices with fallback chain: Binance Futures -> Database
 */
export declare function fetchPrices(coin?: string): Promise<CandleData>;
//# sourceMappingURL=price-fetcher.d.ts.map
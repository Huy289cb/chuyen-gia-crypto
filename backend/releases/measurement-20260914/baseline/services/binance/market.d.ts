/**
 * Binance Futures Market Data Module
 *
 * Public market data endpoints for Binance Futures
 */
interface Kline {
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    closeTime: number;
    quoteVolume: number;
    trades: number;
    takerBuyBaseVolume: number;
    takerBuyQuoteVolume: number;
}
interface BookTicker {
    symbol: string;
    bidPrice: number;
    bidQty: number;
    askPrice: number;
    askQty: number;
}
/**
 * Get Binance server time
 * @returns {Promise<number>} Server timestamp
 */
export declare function getServerTime(): Promise<number>;
/**
 * Get kline (candlestick) data
 * @param {string} symbol - Trading symbol (e.g., BTCUSDT)
 * @param {string} interval - Kline interval (1m, 5m, 15m, 1h, 4h, 1d)
 * @param {number} limit - Number of klines to return (max 1500)
 * @param {number} startTime - Start time in milliseconds
 * @param {number} endTime - End time in milliseconds
 * @returns {Promise<Array>} Array of klines
 */
export declare function getKlines(symbol: string, interval: string, limit?: number, startTime?: number | null, endTime?: number | null): Promise<Kline[]>;
/**
 * Get current price for a symbol
 * @param {string} symbol - Trading symbol (e.g., BTCUSDT)
 * @returns {Promise<number>} Current price
 */
export declare function getPrice(symbol: string): Promise<number>;
/**
 * Get book ticker (best bid/ask prices)
 * @param {string} symbol - Trading symbol (e.g., BTCUSDT)
 * @returns {Promise<object>} Book ticker data
 */
export declare function getBookTicker(symbol: string): Promise<BookTicker>;
/**
 * Get mark price + last funding rate (public premiumIndex).
 */
export declare function getPremiumIndex(symbol: string): Promise<{
    symbol: string;
    markPrice: number;
    lastFundingRate: number;
    nextFundingTime: number;
}>;
/**
 * Get exchange information including trading rules and filters
 * @param {string} symbol - Optional symbol to filter (e.g., BTCUSDT)
 * @returns {Promise<object>} Exchange information with symbol filters
 */
export declare function getExchangeInfo(symbol?: string | null): Promise<any>;
export {};
//# sourceMappingURL=market.d.ts.map
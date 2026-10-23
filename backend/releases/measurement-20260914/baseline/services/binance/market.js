"use strict";
/**
 * Binance Futures Market Data Module
 *
 * Public market data endpoints for Binance Futures
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getServerTime = getServerTime;
exports.getKlines = getKlines;
exports.getPrice = getPrice;
exports.getBookTicker = getBookTicker;
exports.getPremiumIndex = getPremiumIndex;
exports.getExchangeInfo = getExchangeInfo;
const client_1 = require("./client");
const endpoints_1 = require("./endpoints");
/**
 * Get Binance server time
 * @returns {Promise<number>} Server timestamp
 */
async function getServerTime() {
    try {
        const response = await (0, client_1.get)(endpoints_1.endpoints.TIME);
        return response.serverTime;
    }
    catch (error) {
        console.error('[BinanceMarket] Failed to get server time:', error.message);
        throw error;
    }
}
/**
 * Get kline (candlestick) data
 * @param {string} symbol - Trading symbol (e.g., BTCUSDT)
 * @param {string} interval - Kline interval (1m, 5m, 15m, 1h, 4h, 1d)
 * @param {number} limit - Number of klines to return (max 1500)
 * @param {number} startTime - Start time in milliseconds
 * @param {number} endTime - End time in milliseconds
 * @returns {Promise<Array>} Array of klines
 */
async function getKlines(symbol, interval, limit = 500, startTime = null, endTime = null) {
    try {
        const params = {
            symbol,
            interval,
            limit,
        };
        if (startTime)
            params.startTime = startTime;
        if (endTime)
            params.endTime = endTime;
        const response = await (0, client_1.get)(endpoints_1.endpoints.KLINE, params);
        // Format klines
        return response.map((kline) => ({
            openTime: kline[0],
            open: parseFloat(kline[1]),
            high: parseFloat(kline[2]),
            low: parseFloat(kline[3]),
            close: parseFloat(kline[4]),
            volume: parseFloat(kline[5]),
            closeTime: kline[6],
            quoteVolume: parseFloat(kline[7]),
            trades: kline[8],
            takerBuyBaseVolume: parseFloat(kline[9]),
            takerBuyQuoteVolume: parseFloat(kline[10]),
        }));
    }
    catch (error) {
        console.error('[BinanceMarket] Failed to get klines:', error.message);
        throw error;
    }
}
/**
 * Get current price for a symbol
 * @param {string} symbol - Trading symbol (e.g., BTCUSDT)
 * @returns {Promise<number>} Current price
 */
async function getPrice(symbol) {
    try {
        const response = await (0, client_1.get)(endpoints_1.endpoints.PRICE, { symbol });
        return parseFloat(response.price);
    }
    catch (error) {
        console.error('[BinanceMarket] Failed to get price:', error.message);
        throw error;
    }
}
/**
 * Get book ticker (best bid/ask prices)
 * @param {string} symbol - Trading symbol (e.g., BTCUSDT)
 * @returns {Promise<object>} Book ticker data
 */
async function getBookTicker(symbol) {
    try {
        const response = await (0, client_1.get)(endpoints_1.endpoints.BOOK_TICKER, { symbol });
        return {
            symbol: response.symbol,
            bidPrice: parseFloat(response.bidPrice),
            bidQty: parseFloat(response.bidQty),
            askPrice: parseFloat(response.askPrice),
            askQty: parseFloat(response.askQty),
        };
    }
    catch (error) {
        console.error('[BinanceMarket] Failed to get book ticker:', error.message);
        throw error;
    }
}
/**
 * Get mark price + last funding rate (public premiumIndex).
 */
async function getPremiumIndex(symbol) {
    try {
        const response = await (0, client_1.get)(endpoints_1.endpoints.PREMIUM_INDEX, { symbol });
        return {
            symbol: response.symbol,
            markPrice: parseFloat(response.markPrice),
            lastFundingRate: parseFloat(response.lastFundingRate),
            nextFundingTime: Number(response.nextFundingTime),
        };
    }
    catch (error) {
        console.error('[BinanceMarket] Failed to get premium index:', error.message);
        throw error;
    }
}
/**
 * Get exchange information including trading rules and filters
 * @param {string} symbol - Optional symbol to filter (e.g., BTCUSDT)
 * @returns {Promise<object>} Exchange information with symbol filters
 */
async function getExchangeInfo(symbol = null) {
    try {
        const params = symbol ? { symbol } : {};
        const response = await (0, client_1.get)(endpoints_1.endpoints.EXCHANGE_INFO, params);
        if (symbol && response.symbols) {
            const symbolInfo = response.symbols.find((s) => s.symbol === symbol);
            if (!symbolInfo) {
                throw new Error(`Symbol ${symbol} not found in exchange info`);
            }
            return symbolInfo;
        }
        return response;
    }
    catch (error) {
        console.error('[BinanceMarket] Failed to get exchange info:', error.message);
        throw error;
    }
}
//# sourceMappingURL=market.js.map
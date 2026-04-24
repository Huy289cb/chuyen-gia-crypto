/**
 * Binance Futures Market Data Module
 * 
 * Public market data endpoints for Binance Futures
 */

import { get } from './client.js';
import { endpoints } from './endpoints.js';

/**
 * Get Binance server time
 * @returns {Promise<number>} Server timestamp
 */
export async function getServerTime() {
  try {
    const response = await get(endpoints.TIME);
    return response.serverTime;
  } catch (error) {
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
export async function getKlines(symbol, interval, limit = 500, startTime = null, endTime = null) {
  try {
    const params = {
      symbol,
      interval,
      limit,
    };

    if (startTime) params.startTime = startTime;
    if (endTime) params.endTime = endTime;

    const response = await get(endpoints.KLINE, params);
    
    // Format klines
    return response.map(kline => ({
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
  } catch (error) {
    console.error('[BinanceMarket] Failed to get klines:', error.message);
    throw error;
  }
}

/**
 * Get current price for a symbol
 * @param {string} symbol - Trading symbol (e.g., BTCUSDT)
 * @returns {Promise<number>} Current price
 */
export async function getPrice(symbol) {
  try {
    const response = await get(endpoints.PRICE, { symbol });
    return parseFloat(response.price);
  } catch (error) {
    console.error('[BinanceMarket] Failed to get price:', error.message);
    throw error;
  }
}

/**
 * Get book ticker (best bid/ask prices)
 * @param {string} symbol - Trading symbol (e.g., BTCUSDT)
 * @returns {Promise<object>} Book ticker data
 */
export async function getBookTicker(symbol) {
  try {
    const response = await get(endpoints.BOOK_TICKER, { symbol });
    return {
      symbol: response.symbol,
      bidPrice: parseFloat(response.bidPrice),
      bidQty: parseFloat(response.bidQty),
      askPrice: parseFloat(response.askPrice),
      askQty: parseFloat(response.askQty),
    };
  } catch (error) {
    console.error('[BinanceMarket] Failed to get book ticker:', error.message);
    throw error;
  }
}

/**
 * Binance Futures Market Data Module
 * 
 * Public market data endpoints for Binance Futures
 */

import { get } from './client';
import { endpoints } from './endpoints';

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
export async function getServerTime(): Promise<number> {
  try {
    const response: any = await get(endpoints.TIME);
    return response.serverTime;
  } catch (error: any) {
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
export async function getKlines(
  symbol: string,
  interval: string,
  limit: number = 500,
  startTime: number | null = null,
  endTime: number | null = null
): Promise<Kline[]> {
  try {
    const params: any = {
      symbol,
      interval,
      limit,
    };

    if (startTime) params.startTime = startTime;
    if (endTime) params.endTime = endTime;

    const response: any = await get(endpoints.KLINE, params);
    
    // Format klines
    return response.map((kline: any) => ({
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
  } catch (error: any) {
    console.error('[BinanceMarket] Failed to get klines:', error.message);
    throw error;
  }
}

/**
 * Get current price for a symbol
 * @param {string} symbol - Trading symbol (e.g., BTCUSDT)
 * @returns {Promise<number>} Current price
 */
export async function getPrice(symbol: string): Promise<number> {
  try {
    const response: any = await get(endpoints.PRICE, { symbol });
    return parseFloat(response.price);
  } catch (error: any) {
    console.error('[BinanceMarket] Failed to get price:', error.message);
    throw error;
  }
}

/**
 * Get book ticker (best bid/ask prices)
 * @param {string} symbol - Trading symbol (e.g., BTCUSDT)
 * @returns {Promise<object>} Book ticker data
 */
export async function getBookTicker(symbol: string): Promise<BookTicker> {
  try {
    const response: any = await get(endpoints.BOOK_TICKER, { symbol });
    return {
      symbol: response.symbol,
      bidPrice: parseFloat(response.bidPrice),
      bidQty: parseFloat(response.bidQty),
      askPrice: parseFloat(response.askPrice),
      askQty: parseFloat(response.askQty),
    };
  } catch (error: any) {
    console.error('[BinanceMarket] Failed to get book ticker:', error.message);
    throw error;
  }
}

/**
 * Get exchange information including trading rules and filters
 * @param {string} symbol - Optional symbol to filter (e.g., BTCUSDT)
 * @returns {Promise<object>} Exchange information with symbol filters
 */
export async function getExchangeInfo(symbol: string | null = null): Promise<any> {
  try {
    const params = symbol ? { symbol } : {};
    const response: any = await get(endpoints.EXCHANGE_INFO, params);
    
    if (symbol && response.symbols) {
      const symbolInfo = response.symbols.find((s: any) => s.symbol === symbol);
      if (!symbolInfo) {
        throw new Error(`Symbol ${symbol} not found in exchange info`);
      }
      return symbolInfo;
    }
    
    return response;
  } catch (error: any) {
    console.error('[BinanceMarket] Failed to get exchange info:', error.message);
    throw error;
  }
}

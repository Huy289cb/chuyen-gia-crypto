/**
 * Binance Futures Configuration
 * 
 * This module exports configuration for Binance Futures integration
 * Supports both Demo Trading (demo-fapi.binance.com) and Mainnet (fapi.binance.com)
 */

export const binanceConfig = {
  // API Configuration - Uses new environment variables
  apiKey: process.env.BINANCE_API_KEY || '',
  secretKey: process.env.BINANCE_API_SECRET || '',
  enabled: process.env.BINANCE_ENABLED === 'true',
  
  // Trading Configuration
  symbol: process.env.BINANCE_SYMBOL || 'BTCUSDT',
  leverage: parseInt(process.env.BINANCE_LEVERAGE || '20', 10),
  
  // Rate Limits (Binance Futures)
  // https://developers.binance.com/docs/derivatives/usdm/introduction
  rateLimits: {
    requestWeight: 2400, // per minute (API request weight limit)
    orderRate: 1200, // per minute (order placement limit)
    rawRequests: 1200, // per minute (raw HTTP requests)
  },
  
  // Order Types
  orderTypes: {
    MARKET: 'MARKET',
    LIMIT: 'LIMIT',
    STOP_MARKET: 'STOP_MARKET',
    STOP_LIMIT: 'STOP_LIMIT',
    TAKE_PROFIT_MARKET: 'TAKE_PROFIT_MARKET',
    TAKE_PROFIT_LIMIT: 'TAKE_PROFIT_LIMIT',
  },
  
  // Position Sides
  sides: {
    BUY: 'BUY',
    SELL: 'SELL',
  },
  
  // Position Types
  positionSides: {
    BOTH: 'BOTH',
    LONG: 'LONG',
    SHORT: 'SHORT',
  },
  
  // Time in Force
  timeInForce: {
    GTC: 'GTC', // Good Till Cancel
    IOC: 'IOC', // Immediate or Cancel
    FOK: 'FOK', // Fill or Kill
    GTX: 'GTX', // Good Till Crossing (Post Only)
  },
  
  // Working Hours (UTC)
  workingHours: {
    london: { start: 7, end: 10 }, // 07:00-10:00 UTC
    nyKillzone: { start: 12, end: 15 }, // 12:00-15:00 UTC
  },
};

/**
 * Validate API keys on startup
 */
export function validateConfig() {
  if (binanceConfig.enabled) {
    if (!binanceConfig.apiKey || !binanceConfig.secretKey) {
      console.error('[BinanceConfig] Binance is enabled but API keys are missing');
      return false;
    }
    console.log('[BinanceConfig] Binance configuration validated successfully');
    return true;
  }
  console.log('[BinanceConfig] Binance is disabled');
  return true;
}

/**
 * Get leverage for trading
 */
export function getLeverage() {
  return binanceConfig.leverage;
}

/**
 * Get trading symbol
 */
export function getSymbol() {
  return binanceConfig.symbol;
}

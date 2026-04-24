/**
 * Binance Futures Testnet Configuration
 * 
 * This module exports configuration for Binance Futures Testnet integration
 */

export const binanceConfig = {
  // Testnet API endpoints
  testnetBaseUrl: 'https://demo-fapi.binance.com',
  mainnetBaseUrl: 'https://fapi.binance.com',
  
  // API Configuration
  apiKey: process.env.BINANCE_TESTNET_API_KEY || '',
  secretKey: process.env.BINANCE_TESTNET_SECRET_KEY || '',
  enabled: process.env.BINANCE_TESTNET_ENABLED === 'true',
  
  // Trading Configuration
  symbol: process.env.BINANCE_TESTNET_SYMBOL || 'BTCUSDT',
  leverage: parseInt(process.env.BINANCE_TESTNET_LEVERAGE || '1', 10),
  
  // Rate Limits (Binance Futures Testnet)
  // https://binance-docs.github.io/apidocs/futures/en/#limits
  rateLimits: {
    requestWeight: 2400, // per minute
    orderRate: 1200, // per minute
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
      console.error('[BinanceConfig] Testnet is enabled but API keys are missing');
      return false;
    }
    console.log('[BinanceConfig] Testnet configuration validated successfully');
    return true;
  }
  console.log('[BinanceConfig] Testnet is disabled');
  return true;
}

/**
 * Get base URL based on environment
 */
export function getBaseUrl() {
  return binanceConfig.testnetBaseUrl;
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

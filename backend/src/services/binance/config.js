/**
 * Binance Futures Configuration
 * 
 * Configuration for Binance Futures API (Demo + Mainnet)
 */

export const config = {
  // API Base URLs
  BASE_URL: process.env.BINANCE_BASE_URL || 'https://demo-fapi.binance.com',
  
  // API Credentials
  API_KEY: process.env.BINANCE_API_KEY || '',
  API_SECRET: process.env.BINANCE_API_SECRET || '',
  
  // Request Configuration
  RECV_WINDOW: parseInt(process.env.BINANCE_RECV_WINDOW || '5000', 10),
  
  // Trading Configuration
  SYMBOL: process.env.BINANCE_SYMBOL || 'BTCUSDT',
  LEVERAGE: parseInt(process.env.BINANCE_LEVERAGE || '20', 10),
  
  // Rate Limits
  RATE_LIMITS: {
    REQUEST_WEIGHT: 2400, // per minute
    ORDER_RATE: 1200, // per minute
    RAW_REQUESTS: 1200, // per minute
  },
  
  // Order Types
  ORDER_TYPES: {
    MARKET: 'MARKET',
    LIMIT: 'LIMIT',
    STOP_MARKET: 'STOP_MARKET',
    STOP_LIMIT: 'STOP_LIMIT',
    TAKE_PROFIT_MARKET: 'TAKE_PROFIT_MARKET',
    TAKE_PROFIT_LIMIT: 'TAKE_PROFIT_LIMIT',
  },
  
  // Position Sides
  SIDES: {
    BUY: 'BUY',
    SELL: 'SELL',
  },
  
  // Time in Force
  TIME_IN_FORCE: {
    GTC: 'GTC', // Good Till Cancel
    IOC: 'IOC', // Immediate or Cancel
    FOK: 'FOK', // Fill or Kill
    GTX: 'GTX', // Good Till Crossing (Post Only)
  },
  
  // Margin Types
  MARGIN_TYPES: {
    ISOLATED: 'ISOLATED',
    CROSSED: 'CROSSED',
  },
};

/**
 * Validate configuration
 * @returns {boolean} True if valid
 */
export function validateConfig() {
  if (!config.API_KEY || !config.API_SECRET) {
    console.error('[BinanceConfig] API keys are missing');
    return false;
  }
  console.log('[BinanceConfig] Configuration validated successfully');
  console.log(`[BinanceConfig] Base URL: ${config.BASE_URL}`);
  return true;
}

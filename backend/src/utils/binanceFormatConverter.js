/**
 * Binance Format Converter
 * 
 * Converts between internal system formats and Binance API formats.
 * This ensures consistent parameter formatting when calling Binance APIs.
 */

/**
 * Convert internal side format to Binance API format
 * @param {string} internalSide - Internal side ('long' or 'short')
 * @returns {string} Binance side ('BUY' or 'SELL')
 * @throws {Error} If internalSide is invalid
 */
export function toBinanceSide(internalSide) {
  if (internalSide === 'long') {
    return 'BUY';
  } else if (internalSide === 'short') {
    return 'SELL';
  } else if (internalSide === 'BUY' || internalSide === 'SELL') {
    // Already in Binance format, return as-is
    return internalSide;
  }
  throw new Error(`Invalid internal side: ${internalSide}. Expected 'long', 'short', 'BUY', or 'SELL'`);
}

/**
 * Convert Binance API side format to internal format
 * @param {string} binanceSide - Binance side ('BUY' or 'SELL')
 * @returns {string} Internal side ('long' or 'short')
 * @throws {Error} If binanceSide is invalid
 */
export function fromBinanceSide(binanceSide) {
  if (binanceSide === 'BUY') {
    return 'long';
  } else if (binanceSide === 'SELL') {
    return 'short';
  } else if (binanceSide === 'long' || binanceSide === 'short') {
    // Already in internal format, return as-is
    return binanceSide;
  }
  throw new Error(`Invalid Binance side: ${binanceSide}. Expected 'BUY', 'SELL', 'long', or 'short'`);
}

/**
 * Convert internal order type to Binance API format
 * @param {string} internalType - Internal type ('market' or 'limit')
 * @returns {string} Binance type ('MARKET' or 'LIMIT')
 * @throws {Error} If internalType is invalid
 */
export function toBinanceOrderType(internalType) {
  const typeMap = {
    'market': 'MARKET',
    'limit': 'LIMIT',
    'stop_market': 'STOP_MARKET',
    'stop_limit': 'STOP_LIMIT',
    'take_profit_market': 'TAKE_PROFIT_MARKET',
    'take_profit_limit': 'TAKE_PROFIT_LIMIT',
  };
  
  const binanceType = typeMap[internalType?.toLowerCase()];
  if (!binanceType) {
    throw new Error(`Invalid internal order type: ${internalType}. Expected one of: ${Object.keys(typeMap).join(', ')}`);
  }
  return binanceType;
}

/**
 * Validate Binance side parameter
 * @param {string} side - Side to validate
 * @returns {boolean} True if valid
 */
export function isValidBinanceSide(side) {
  return ['BUY', 'SELL'].includes(side);
}

/**
 * Validate internal side parameter
 * @param {string} side - Side to validate
 * @returns {boolean} True if valid
 */
export function isValidInternalSide(side) {
  return ['long', 'short'].includes(side);
}

/**
 * Validate Binance order type parameter
 * @param {string} type - Type to validate
 * @returns {boolean} True if valid
 */
export function isValidBinanceOrderType(type) {
  const validTypes = ['MARKET', 'LIMIT', 'STOP_MARKET', 'STOP_LIMIT', 'TAKE_PROFIT_MARKET', 'TAKE_PROFIT_LIMIT'];
  return validTypes.includes(type);
}

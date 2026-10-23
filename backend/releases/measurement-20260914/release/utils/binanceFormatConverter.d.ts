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
export declare function toBinanceSide(internalSide: string): string;
/**
 * Convert Binance API side format to internal format
 * @param {string} binanceSide - Binance side ('BUY' or 'SELL')
 * @returns {string} Internal side ('long' or 'short')
 * @throws {Error} If binanceSide is invalid
 */
export declare function fromBinanceSide(binanceSide: string): string;
/**
 * Convert internal order type to Binance API format
 * @param {string} internalType - Internal type ('market' or 'limit')
 * @returns {string} Binance type ('MARKET' or 'LIMIT')
 * @throws {Error} If internalType is invalid
 */
export declare function toBinanceOrderType(internalType: string): string;
/**
 * Validate Binance side parameter
 * @param {string} side - Side to validate
 * @returns {boolean} True if valid
 */
export declare function isValidBinanceSide(side: string): boolean;
/**
 * Validate internal side parameter
 * @param {string} side - Side to validate
 * @returns {boolean} True if valid
 */
export declare function isValidInternalSide(side: string): boolean;
/**
 * Validate Binance order type parameter
 * @param {string} type - Type to validate
 * @returns {boolean} True if valid
 */
export declare function isValidBinanceOrderType(type: string): boolean;
//# sourceMappingURL=binanceFormatConverter.d.ts.map
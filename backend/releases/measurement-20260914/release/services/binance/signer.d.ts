/**
 * Binance API Signature Module
 *
 * Generates HMAC SHA256 signatures for signed Binance API requests
 */
/**
 * Sign query string with HMAC SHA256
 * @param {string} query - URL-encoded query string
 * @param {string} secret - API secret key
 * @returns {string} Hex-encoded signature
 */
export declare function sign(query: string, secret: string): string;
//# sourceMappingURL=signer.d.ts.map
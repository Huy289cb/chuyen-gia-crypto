/**
 * Binance API Signature Module
 * 
 * Generates HMAC SHA256 signatures for signed Binance API requests
 */

import crypto from 'crypto';

/**
 * Sign query string with HMAC SHA256
 * @param {string} query - URL-encoded query string
 * @param {string} secret - API secret key
 * @returns {string} Hex-encoded signature
 */
export function sign(query, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(query)
    .digest('hex');
}

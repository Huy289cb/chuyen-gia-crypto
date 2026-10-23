"use strict";
/**
 * Binance API Signature Module
 *
 * Generates HMAC SHA256 signatures for signed Binance API requests
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sign = sign;
const crypto_1 = __importDefault(require("crypto"));
/**
 * Sign query string with HMAC SHA256
 * @param {string} query - URL-encoded query string
 * @param {string} secret - API secret key
 * @returns {string} Hex-encoded signature
 */
function sign(query, secret) {
    return crypto_1.default
        .createHmac('sha256', secret)
        .update(query)
        .digest('hex');
}
//# sourceMappingURL=signer.js.map
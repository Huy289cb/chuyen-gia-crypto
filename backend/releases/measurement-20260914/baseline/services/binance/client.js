"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.request = request;
exports.requestWithRetry = requestWithRetry;
exports.get = get;
exports.post = post;
exports.del = del;
exports.put = put;
const binance_income_json_1 = require("../../utils/binance-income-json");
/**
 * Binance Futures HTTP Client
 *
 * Core HTTP client for making requests to Binance Futures API
 * Handles signature generation, error handling, and retry logic
 */
const axios_1 = __importDefault(require("axios"));
const signer_1 = require("./signer");
const config_1 = require("./config");
const mainnet_safety_1 = require("../../config/mainnet-safety");
// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const NON_RETRIABLE_ERROR_CODES = new Set([
    -5000, // Invalid request path/contract
    -2015, // Invalid API key or permissions
    -2022, // ReduceOnly order rejected
    -4046, // Margin type already set
    -4059, // Position mode already set
]);
const RETRIABLE_ERROR_CODES = new Set([
    -1008, // Too many requests
    -1021, // Timestamp outside recvWindow
]);
function isOrderEndpoint(path) {
    return /\/order(\/test)?$/.test(path) || path === '/fapi/v1/algoOrder';
}
function isRetriableBinanceError(code, path) {
    if (RETRIABLE_ERROR_CODES.has(code)) {
        return true;
    }
    // Demo can return transient -1109 on order endpoints; balance/positionRisk -1109 is persistent.
    if (code === -1109 && isOrderEndpoint(path)) {
        return true;
    }
    return false;
}
function createBinanceApiError(code, msg, path) {
    const error = new Error(`Binance API Error ${code}: ${msg}`);
    error.code = code;
    error.binanceCode = code;
    error.retriable = isRetriableBinanceError(code, path);
    error.nonRetriable = NON_RETRIABLE_ERROR_CODES.has(code) && !error.retriable;
    return error;
}
/**
 * Make a request to Binance Futures API
 * @param {string} method - HTTP method (GET, POST, DELETE)
 * @param {string} path - API endpoint path
 * @param {object} params - Query parameters
 * @param {boolean} signed - Whether to sign the request
 * @returns {Promise<object>} Response data
 */
async function request(method, path, params = {}, signed = false) {
    (0, mainnet_safety_1.assertBinanceMutationAllowed)(method, path);
    const timestamp = Date.now();
    let queryParams = new URLSearchParams({
        ...params,
        ...(signed && {
            timestamp: String(timestamp),
            recvWindow: String(config_1.config.RECV_WINDOW),
        }),
    }).toString();
    if (signed) {
        const signature = (0, signer_1.sign)(queryParams, config_1.config.API_SECRET);
        queryParams += `&signature=${signature}`;
    }
    const url = `${config_1.config.BASE_URL}${path}?${queryParams}`;
    try {
        const response = await (0, axios_1.default)({
            method,
            url,
            headers: {
                'X-MBX-APIKEY': config_1.config.API_KEY,
                'Content-Type': 'application/json',
            },
            timeout: 30000,
            ...(path === '/fapi/v1/income' ? { transformResponse: [binance_income_json_1.parseBinanceIncomeJson] } : {}),
        });
        return response.data;
    }
    catch (error) {
        if (error.response) {
            // Binance API error
            const { code, msg } = error.response.data;
            const apiError = createBinanceApiError(code, msg, path);
            // Handle specific error codes that are expected/normal
            if (code === -1021) {
                // Timestamp for this request is outside of the recvWindow
                console.error('[BinanceClient] Timestamp error - sync time with server');
            }
            else if (code === -1109) {
                const hint = isOrderEndpoint(path)
                    ? 'transient demo error on order endpoint — will retry if applicable'
                    : 'demo metadata endpoint (-1109); trading may still work via order/openOrders';
                console.error(`[BinanceClient] Invalid account (-1109) on ${path}: ${hint}`);
            }
            else if (code === -2015) {
                // Invalid API-key, IP, or permissions
                console.error('[BinanceClient] Invalid API key or permissions');
            }
            else if (code === -1008) {
                // Too many requests
                console.error('[BinanceClient] Rate limit exceeded');
            }
            else if (code === -4046) {
                // No need to change margin type (already set) - expected
                console.log('[BinanceClient] Margin type already set');
                throw apiError;
            }
            else if (code === -4059) {
                // No need to change position side (already set) - expected
                console.log('[BinanceClient] Position mode already set');
                throw apiError;
            }
            else if (code === -2022) {
                // ReduceOnly order rejected (no position to reduce) - expected
                console.log('[BinanceClient] ReduceOnly order rejected (no position to reduce)');
                throw apiError;
            }
            else {
                // Other errors
                console.error(`[BinanceClient] API Error ${code}: ${msg}`);
            }
            throw apiError;
        }
        else if (error.request) {
            // Request made but no response
            console.error('[BinanceClient] No response from server');
            const requestError = new Error('No response from Binance server');
            requestError.retriable = true;
            throw requestError;
        }
        else {
            // Request setup error
            console.error('[BinanceClient] Request setup error:', error.message);
            error.retriable = false;
            throw error;
        }
    }
}
/**
 * Make a request with retry logic
 * @param {string} method - HTTP method
 * @param {string} path - API endpoint path
 * @param {object} params - Query parameters
 * @param {boolean} signed - Whether to sign the request
 * @returns {Promise<object>} Response data
 */
async function requestWithRetry(method, path, params = {}, signed = false) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await request(method, path, params, signed);
        }
        catch (error) {
            lastError = error;
            if (error.nonRetriable || error.retriable === false) {
                throw error;
            }
            if (attempt < MAX_RETRIES) {
                const errorType = error.retriable ? 'transient' : 'unknown';
                console.warn(`[BinanceClient] Request failed (${errorType}, attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY_MS}ms...`);
                await delay(RETRY_DELAY_MS);
            }
        }
    }
    throw lastError;
}
/**
 * Delay execution for specified milliseconds
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * GET request
 */
async function get(path, params = {}, signed = false) {
    return requestWithRetry('GET', path, params, signed);
}
/**
 * POST request
 */
async function post(path, params = {}, signed = false) {
    return requestWithRetry('POST', path, params, signed);
}
/**
 * DELETE request
 */
async function del(path, params = {}, signed = false) {
    return requestWithRetry('DELETE', path, params, signed);
}
/**
 * PUT request
 */
async function put(path, params = {}, signed = false) {
    return requestWithRetry('PUT', path, params, signed);
}
//# sourceMappingURL=client.js.map
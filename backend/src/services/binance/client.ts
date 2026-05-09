/**
 * Binance Futures HTTP Client
 * 
 * Core HTTP client for making requests to Binance Futures API
 * Handles signature generation, error handling, and retry logic
 */

import axios from 'axios';
import { sign } from './signer';
import { config } from './config';

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

interface BinanceApiError extends Error {
  code?: number;
  binanceCode?: number;
  retriable?: boolean;
  nonRetriable?: boolean;
}

function createBinanceApiError(code: number, msg: string): BinanceApiError {
  const error = new Error(`Binance API Error ${code}: ${msg}`) as BinanceApiError;
  error.code = code;
  error.binanceCode = code;
  error.retriable = RETRIABLE_ERROR_CODES.has(code);
  error.nonRetriable = NON_RETRIABLE_ERROR_CODES.has(code);
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
export async function request(method: string, path: string, params: any = {}, signed: boolean = false): Promise<any> {
  const timestamp = Date.now();

  let queryParams = new URLSearchParams({
    ...params,
    ...(signed && { timestamp }),
  }).toString();

  if (signed) {
    const signature = sign(queryParams, config.API_SECRET);
    queryParams += `&signature=${signature}`;
  }

  const url = `${config.BASE_URL}${path}?${queryParams}`;

  try {
    const response = await axios({
      method,
      url,
      headers: {
        'X-MBX-APIKEY': config.API_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    return response.data;
  } catch (error: any) {
    if (error.response) {
      // Binance API error
      const { code, msg } = error.response.data;
      const apiError = createBinanceApiError(code, msg);
      
      // Handle specific error codes that are expected/normal
      if (code === -1021) {
        // Timestamp for this request is outside of the recvWindow
        console.error('[BinanceClient] Timestamp error - sync time with server');
      } else if (code === -2015) {
        // Invalid API-key, IP, or permissions
        console.error('[BinanceClient] Invalid API key or permissions');
      } else if (code === -1008) {
        // Too many requests
        console.error('[BinanceClient] Rate limit exceeded');
      } else if (code === -4046) {
        // No need to change margin type (already set) - expected
        console.log('[BinanceClient] Margin type already set');
        throw apiError;
      } else if (code === -4059) {
        // No need to change position side (already set) - expected
        console.log('[BinanceClient] Position mode already set');
        throw apiError;
      } else if (code === -2022) {
        // ReduceOnly order rejected (no position to reduce) - expected
        console.log('[BinanceClient] ReduceOnly order rejected (no position to reduce)');
        throw apiError;
      } else {
        // Other errors
        console.error(`[BinanceClient] API Error ${code}: ${msg}`);
      }
      
      throw apiError;
    } else if (error.request) {
      // Request made but no response
      console.error('[BinanceClient] No response from server');
      const requestError = new Error('No response from Binance server') as BinanceApiError;
      requestError.retriable = true;
      throw requestError;
    } else {
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
export async function requestWithRetry(method: string, path: string, params: any = {}, signed: boolean = false): Promise<any> {
  let lastError: any;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await request(method, path, params, signed);
    } catch (error: any) {
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
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * GET request
 */
export async function get(path: string, params: any = {}, signed: boolean = false): Promise<any> {
  return requestWithRetry('GET', path, params, signed);
}

/**
 * POST request
 */
export async function post(path: string, params: any = {}, signed: boolean = false): Promise<any> {
  return requestWithRetry('POST', path, params, signed);
}

/**
 * DELETE request
 */
export async function del(path: string, params: any = {}, signed: boolean = false): Promise<any> {
  return requestWithRetry('DELETE', path, params, signed);
}

/**
 * PUT request
 */
export async function put(path: string, params: any = {}, signed: boolean = false): Promise<any> {
  return requestWithRetry('PUT', path, params, signed);
}

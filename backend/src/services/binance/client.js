/**
 * Binance Futures HTTP Client
 * 
 * Core HTTP client for making requests to Binance Futures API
 * Handles signature generation, error handling, and retry logic
 */

import axios from 'axios';
import { sign } from './signer.js';
import { config } from './config.js';

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Make a request to Binance Futures API
 * @param {string} method - HTTP method (GET, POST, DELETE)
 * @param {string} path - API endpoint path
 * @param {object} params - Query parameters
 * @param {boolean} signed - Whether to sign the request
 * @returns {Promise<object>} Response data
 */
export async function request(method, path, params = {}, signed = false) {
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
  } catch (error) {
    if (error.response) {
      // Binance API error
      const { code, msg } = error.response.data;
      console.error(`[BinanceClient] API Error ${code}: ${msg}`);
      
      // Handle specific error codes
      if (code === -1021) {
        // Timestamp for this request is outside of the recvWindow
        console.error('[BinanceClient] Timestamp error - sync time with server');
      } else if (code === -2015) {
        // Invalid API-key, IP, or permissions
        console.error('[BinanceClient] Invalid API key or permissions');
      } else if (code === -1008) {
        // Too many requests
        console.error('[BinanceClient] Rate limit exceeded');
      }
      
      throw new Error(`Binance API Error ${code}: ${msg}`);
    } else if (error.request) {
      // Request made but no response
      console.error('[BinanceClient] No response from server');
      throw new Error('No response from Binance server');
    } else {
      // Request setup error
      console.error('[BinanceClient] Request setup error:', error.message);
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
export async function requestWithRetry(method, path, params = {}, signed = false) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await request(method, path, params, signed);
    } catch (error) {
      lastError = error;
      
      if (attempt < MAX_RETRIES) {
        console.warn(`[BinanceClient] Request failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY_MS}ms...`);
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
export async function get(path, params = {}, signed = false) {
  return requestWithRetry('GET', path, params, signed);
}

/**
 * POST request
 */
export async function post(path, params = {}, signed = false) {
  return requestWithRetry('POST', path, params, signed);
}

/**
 * DELETE request
 */
export async function del(path, params = {}, signed = false) {
  return requestWithRetry('DELETE', path, params, signed);
}

/**
 * PUT request
 */
export async function put(path, params = {}, signed = false) {
  return requestWithRetry('PUT', path, params, signed);
}

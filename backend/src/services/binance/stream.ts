/**
 * Binance Futures User Data Stream Module
 * 
 * User data stream endpoints for Binance Futures
 */

import { post, del, put } from './client';
import { endpoints } from './endpoints';

/**
 * Start a user data stream (create listen key)
 * @returns {Promise<string>} Listen key
 */
export async function startListenKey(): Promise<string> {
  try {
    const response: any = await post(endpoints.LISTEN_KEY, {}, true);
    console.log('[BinanceStream] Listen key created:', response.listenKey);
    return response.listenKey;
  } catch (error: any) {
    console.error('[BinanceStream] Failed to create listen key:', error.message);
    throw error;
  }
}

/**
 * Keep alive a user data stream
 * @param {string} listenKey - Listen key to keep alive
 * @returns {Promise<object>} Response data
 */
export async function keepAliveListenKey(listenKey: string): Promise<any> {
  try {
    const response: any = await put(endpoints.LISTEN_KEY, { listenKey }, true);
    console.log('[BinanceStream] Listen key kept alive:', listenKey);
    return response;
  } catch (error: any) {
    console.error('[BinanceStream] Failed to keep alive listen key:', error.message);
    throw error;
  }
}

/**
 * Close a user data stream
 * @param {string} listenKey - Listen key to close
 * @returns {Promise<object>} Response data
 */
export async function closeListenKey(listenKey: string): Promise<any> {
  try {
    const response: any = await del(endpoints.LISTEN_KEY, { listenKey }, true);
    console.log('[BinanceStream] Listen key closed:', listenKey);
    return response;
  } catch (error: any) {
    console.error('[BinanceStream] Failed to close listen key:', error.message);
    throw error;
  }
}

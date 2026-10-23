/**
 * Binance Futures User Data Stream Module
 *
 * User data stream endpoints for Binance Futures
 */
/**
 * Start a user data stream (create listen key)
 * @returns {Promise<string>} Listen key
 */
export declare function startListenKey(): Promise<string>;
/**
 * Keep alive a user data stream
 * @param {string} listenKey - Listen key to keep alive
 * @returns {Promise<object>} Response data
 */
export declare function keepAliveListenKey(listenKey: string): Promise<any>;
/**
 * Close a user data stream
 * @param {string} listenKey - Listen key to close
 * @returns {Promise<object>} Response data
 */
export declare function closeListenKey(listenKey: string): Promise<any>;
//# sourceMappingURL=stream.d.ts.map
"use strict";
/**
 * Binance Futures User Data Stream Module
 *
 * User data stream endpoints for Binance Futures
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.startListenKey = startListenKey;
exports.keepAliveListenKey = keepAliveListenKey;
exports.closeListenKey = closeListenKey;
const client_1 = require("./client");
const endpoints_1 = require("./endpoints");
/**
 * Start a user data stream (create listen key)
 * @returns {Promise<string>} Listen key
 */
async function startListenKey() {
    try {
        const response = await (0, client_1.post)(endpoints_1.endpoints.LISTEN_KEY, {}, true);
        console.log('[BinanceStream] Listen key created');
        return response.listenKey;
    }
    catch (error) {
        console.error('[BinanceStream] Failed to create listen key:', error.message);
        throw error;
    }
}
/**
 * Keep alive a user data stream
 * @param {string} listenKey - Listen key to keep alive
 * @returns {Promise<object>} Response data
 */
async function keepAliveListenKey(listenKey) {
    try {
        const response = await (0, client_1.put)(endpoints_1.endpoints.LISTEN_KEY, { listenKey }, true);
        console.log('[BinanceStream] Listen key kept alive');
        return response;
    }
    catch (error) {
        console.error('[BinanceStream] Failed to keep alive listen key:', error.message);
        throw error;
    }
}
/**
 * Close a user data stream
 * @param {string} listenKey - Listen key to close
 * @returns {Promise<object>} Response data
 */
async function closeListenKey(listenKey) {
    try {
        const response = await (0, client_1.del)(endpoints_1.endpoints.LISTEN_KEY, { listenKey }, true);
        console.log('[BinanceStream] Listen key closed');
        return response;
    }
    catch (error) {
        console.error('[BinanceStream] Failed to close listen key:', error.message);
        throw error;
    }
}
//# sourceMappingURL=stream.js.map
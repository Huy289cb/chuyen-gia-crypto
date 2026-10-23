/**
 * Make a request to Binance Futures API
 * @param {string} method - HTTP method (GET, POST, DELETE)
 * @param {string} path - API endpoint path
 * @param {object} params - Query parameters
 * @param {boolean} signed - Whether to sign the request
 * @returns {Promise<object>} Response data
 */
export declare function request(method: string, path: string, params?: any, signed?: boolean): Promise<any>;
/**
 * Make a request with retry logic
 * @param {string} method - HTTP method
 * @param {string} path - API endpoint path
 * @param {object} params - Query parameters
 * @param {boolean} signed - Whether to sign the request
 * @returns {Promise<object>} Response data
 */
export declare function requestWithRetry(method: string, path: string, params?: any, signed?: boolean): Promise<any>;
/**
 * GET request
 */
export declare function get(path: string, params?: any, signed?: boolean): Promise<any>;
/**
 * POST request
 */
export declare function post(path: string, params?: any, signed?: boolean): Promise<any>;
/**
 * DELETE request
 */
export declare function del(path: string, params?: any, signed?: boolean): Promise<any>;
/**
 * PUT request
 */
export declare function put(path: string, params?: any, signed?: boolean): Promise<any>;
//# sourceMappingURL=client.d.ts.map
/**
 * Async helper utilities
 */
/**
 * Helper for Promise.all with timeout to prevent hanging
 * @param {Array<Promise>} promises - Array of promises to execute
 * @param {number} timeoutMs - Timeout in milliseconds (default 30000)
 * @returns {Promise<Array>} Results from all promises
 */
export declare function promiseAllWithTimeout<T>(promises: Promise<T>[], timeoutMs?: number): Promise<T[]>;
//# sourceMappingURL=asyncHelpers.d.ts.map
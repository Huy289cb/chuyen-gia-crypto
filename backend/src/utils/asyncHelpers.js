/**
 * Async helper utilities
 */

/**
 * Helper for Promise.all with timeout to prevent hanging
 * @param {Array<Promise>} promises - Array of promises to execute
 * @param {number} timeoutMs - Timeout in milliseconds (default 30000)
 * @returns {Promise<Array>} Results from all promises
 */
export async function promiseAllWithTimeout(promises, timeoutMs = 30000) {
  return Promise.race([
    Promise.all(promises),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

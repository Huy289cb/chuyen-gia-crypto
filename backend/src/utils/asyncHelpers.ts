/**
 * Async helper utilities
 */

/**
 * Helper for Promise.all with timeout to prevent hanging
 * @param {Array<Promise>} promises - Array of promises to execute
 * @param {number} timeoutMs - Timeout in milliseconds (default 30000)
 * @returns {Promise<Array>} Results from all promises
 */
export async function promiseAllWithTimeout<T>(promises: Promise<T>[], timeoutMs: number = 30000): Promise<T[]> {
  return Promise.race([
    Promise.all(promises),
    new Promise<T[]>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

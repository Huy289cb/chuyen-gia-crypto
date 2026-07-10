/**
 * Short-TTL in-memory cache for read-only API responses (dashboard / market).
 * Safe only when stale data by a few seconds does not affect trading execution.
 */

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export class ReadThroughCache {
  private store = new Map<string, CacheEntry<unknown>>();

  async get<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.store.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.value as T;
    }

    const value = await loader();
    this.store.set(key, { value, expiresAt: now + ttlMs });
    return value;
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }
}

export const readCache = new ReadThroughCache();

/** Dashboard read-only panels (system, schedulers, warmup, intel slices). */
export const DASHBOARD_READ_TTL_MS = parseInt(process.env.DASHBOARD_READ_CACHE_TTL_MS || '30000', 10);

/** Event log merge (heavier query). */
export const DASHBOARD_EVENTS_TTL_MS = parseInt(process.env.DASHBOARD_EVENTS_CACHE_TTL_MS || '20000', 10);

/** Warmup counts change slowly during initial load. */
export const DASHBOARD_WARMUP_TTL_MS = parseInt(process.env.DASHBOARD_WARMUP_CACHE_TTL_MS || '60000', 10);

/** Account balance aggregates (not execution). */
export const ACCOUNT_BALANCE_TTL_MS = parseInt(process.env.ACCOUNT_BALANCE_CACHE_TTL_MS || '20000', 10);

/** Market chart + indicators from shared candle fetch. */
export const MARKET_READ_TTL_MS = parseInt(process.env.MARKET_READ_CACHE_TTL_MS || '25000', 10);

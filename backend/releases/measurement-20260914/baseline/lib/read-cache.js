"use strict";
/**
 * Short-TTL in-memory cache for read-only API responses (dashboard / market).
 * Safe only when stale data by a few seconds does not affect trading execution.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MARKET_READ_TTL_MS = exports.ACCOUNT_BALANCE_TTL_MS = exports.DASHBOARD_WARMUP_TTL_MS = exports.DASHBOARD_EVENTS_TTL_MS = exports.DASHBOARD_READ_TTL_MS = exports.readCache = exports.ReadThroughCache = void 0;
class ReadThroughCache {
    store = new Map();
    async get(key, ttlMs, loader) {
        const now = Date.now();
        const hit = this.store.get(key);
        if (hit && hit.expiresAt > now) {
            return hit.value;
        }
        const value = await loader();
        this.store.set(key, { value, expiresAt: now + ttlMs });
        return value;
    }
    invalidate(key) {
        this.store.delete(key);
    }
    invalidatePrefix(prefix) {
        for (const key of this.store.keys()) {
            if (key.startsWith(prefix)) {
                this.store.delete(key);
            }
        }
    }
}
exports.ReadThroughCache = ReadThroughCache;
exports.readCache = new ReadThroughCache();
/** Dashboard read-only panels (system, schedulers, warmup, intel slices). */
exports.DASHBOARD_READ_TTL_MS = parseInt(process.env.DASHBOARD_READ_CACHE_TTL_MS || '30000', 10);
/** Event log merge (heavier query). */
exports.DASHBOARD_EVENTS_TTL_MS = parseInt(process.env.DASHBOARD_EVENTS_CACHE_TTL_MS || '20000', 10);
/** Warmup counts change slowly during initial load. */
exports.DASHBOARD_WARMUP_TTL_MS = parseInt(process.env.DASHBOARD_WARMUP_CACHE_TTL_MS || '60000', 10);
/** Account balance aggregates (not execution). */
exports.ACCOUNT_BALANCE_TTL_MS = parseInt(process.env.ACCOUNT_BALANCE_CACHE_TTL_MS || '20000', 10);
/** Market chart + indicators from shared candle fetch. */
exports.MARKET_READ_TTL_MS = parseInt(process.env.MARKET_READ_CACHE_TTL_MS || '25000', 10);
//# sourceMappingURL=read-cache.js.map
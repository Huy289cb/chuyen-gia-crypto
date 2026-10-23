/**
 * Short-TTL in-memory cache for read-only API responses (dashboard / market).
 * Safe only when stale data by a few seconds does not affect trading execution.
 */
export declare class ReadThroughCache {
    private store;
    get<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T>;
    invalidate(key: string): void;
    invalidatePrefix(prefix: string): void;
}
export declare const readCache: ReadThroughCache;
/** Dashboard read-only panels (system, schedulers, warmup, intel slices). */
export declare const DASHBOARD_READ_TTL_MS: number;
/** Event log merge (heavier query). */
export declare const DASHBOARD_EVENTS_TTL_MS: number;
/** Warmup counts change slowly during initial load. */
export declare const DASHBOARD_WARMUP_TTL_MS: number;
/** Account balance aggregates (not execution). */
export declare const ACCOUNT_BALANCE_TTL_MS: number;
/** Market chart + indicators from shared candle fetch. */
export declare const MARKET_READ_TTL_MS: number;
//# sourceMappingURL=read-cache.d.ts.map
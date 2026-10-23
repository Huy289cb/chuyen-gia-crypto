/** Freshness policy for HTF snapshots consumed by live entry hard gates. */
export declare const DEFAULT_HTF_SCAN_MAX_AGE_MS: number;
export declare function getHtfScanMaxAgeMs(): number;
export interface ScanFreshnessResult {
    pass: boolean;
    ageMs?: number;
    reason?: string;
}
/** Missing, invalid, future-dated, or stale timestamps fail closed. */
export declare function evaluateScanFreshness(timestamp: Date | number | null | undefined, options?: {
    nowMs?: number;
    maxAgeMs?: number;
    label?: string;
}): ScanFreshnessResult;
//# sourceMappingURL=scan-freshness.d.ts.map
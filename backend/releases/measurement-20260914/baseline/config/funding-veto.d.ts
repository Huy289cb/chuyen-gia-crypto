/**
 * Extreme funding crowd veto (offense filter — not size cut).
 * Positive funding → longs pay shorts → block new longs when |rate| high.
 */
export interface FundingVetoResult {
    pass: boolean;
    reason?: string;
}
export declare function isFundingVetoEnabled(): boolean;
export declare function getFundingVetoAbs(): number;
/**
 * @param fundingRate Binance lastFundingRate (e.g. 0.0003 = 0.03%)
 * Fail-open when rate is null (fetch error) — caller decides.
 */
export declare function evaluateFundingVeto(input: {
    side: 'long' | 'short';
    fundingRate: number | null;
    enabled?: boolean;
    absThreshold?: number;
}): FundingVetoResult;
/** Cached lastFundingRate; null on failure (caller fail-open). */
export declare function fetchCachedFundingRate(symbol: string, fetchPremium: (sym: string) => Promise<{
    lastFundingRate: number;
}>): Promise<number | null>;
//# sourceMappingURL=funding-veto.d.ts.map
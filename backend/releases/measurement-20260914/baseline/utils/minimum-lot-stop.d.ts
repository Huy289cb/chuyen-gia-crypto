export interface MinimumLotStopInput {
    action: 'buy' | 'sell';
    entry: number;
    stopLoss: number;
    takeProfit: number;
    orderQty: number;
    balance: number;
    minSlPct: number;
    maxEffectiveRiskPct: number;
    minRr: number;
    preferredMaxSlPct?: number;
    priceTickSize?: number;
}
export interface MinimumLotStopResult {
    adjusted: boolean;
    stopLoss: number;
    takeProfit: number;
    originalStopPct: number;
    normalizedStopPct: number;
    maxFeasibleStopPct: number;
    effectiveRiskPct: number;
    expectedRr: number;
    reason: string;
}
/**
 * Tighten a stop only when an exchange minimum lot would otherwise breach the
 * effective wallet-risk ceiling. The result is valid only when a cent-rounded
 * stop exists between the configured minimum SL and the cap-derived maximum.
 */
export declare function normalizeMinimumLotStop(input: MinimumLotStopInput): MinimumLotStopResult | null;
//# sourceMappingURL=minimum-lot-stop.d.ts.map
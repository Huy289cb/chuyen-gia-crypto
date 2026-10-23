/**
 * Pure SL tighten math for breakeven + trail (no I/O).
 */
export type ProfitProtectSide = 'long' | 'short';
export interface ProfitProtectInput {
    side: ProfitProtectSide;
    entry: number;
    mark: number;
    currentSl: number;
    /** Original planned risk distance; if omitted, inferred from |entry - currentSl| when currentSl is on risk side. */
    initialRisk?: number;
    ageMinutes: number;
    beAtR: number;
    trailActivatePct: number;
    trailDistancePct: number;
    minSlMovePct: number;
    minAgeMinutes: number;
    timeStopHours: number;
    /** Move BE into profit by this % of entry (fee cover). Default 0. */
    beFeeBufferPct?: number;
}
export interface ProfitProtectResult {
    action: 'none' | 'breakeven' | 'trail' | 'time_stop_be';
    newSl: number;
    reason: string;
    unrealizedPct: number;
    rMultiple: number;
}
export declare function computeProfitProtectSl(input: ProfitProtectInput): ProfitProtectResult;
//# sourceMappingURL=profit-protect-sl.d.ts.map
/**
 * Expectancy rollup from trade_outcomes (realized_rr / realized_pnl).
 */
export interface OutcomeRow {
    realized_rr: number;
    realized_pnl: number;
}
export interface ExpectancyRollup {
    n: number;
    wins: number;
    losses: number;
    breakeven: number;
    sumR: number;
    avgR: number;
    /** Gross wins / |gross losses| on PnL; null if no losses. */
    profitFactor: number | null;
    sumPnl: number;
    winRate: number | null;
}
export declare function rollupExpectancyFromOutcomes(rows: OutcomeRow[]): ExpectancyRollup;
/** Fix PF: when no losses but wins, PF is Infinity conceptually — expose null and flag via wins. */
export declare function profitFactorLabel(pf: number | null, wins: number, losses: number): string;
//# sourceMappingURL=expectancy-rollup.service.d.ts.map
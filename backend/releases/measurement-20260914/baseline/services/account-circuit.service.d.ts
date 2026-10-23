/**
 * Phase 0 account circuits: daily loss %, peak drawdown %, expectancy kill.
 * Soft-block new entries (no flatten). Peak equity from starting_balance + snapshots.
 */
export interface CircuitStatus {
    scope: 'strategy_epoch';
    epochStart: Date | null;
    peakEquitySource: 'override' | 'override_ratcheted' | 'strategy_epoch_snapshots' | 'full_history_snapshots';
    expectancySince: Date | null;
    allowed: boolean;
    reason: string;
    startEquity?: number;
    dailyLossUsd: number;
    dailyLossPercent: number;
    dailyLossLimitPercent: number;
    peakEquity: number;
    drawdownPercent: number;
    maxDrawdownPercent: number;
    expectancy: {
        n: number;
        sumR: number;
        avgR: number;
        profitFactor: number | null;
    };
}
/** Loss from day-start equity as percent of start (0 if flat/up). */
export declare function calcDailyLossPercent(startEquity: number, currentEquity: number): number;
/** Drawdown from peak as percent of peak (0 if at/above peak). */
export declare function calcDrawdownPercent(peakEquity: number, currentEquity: number): number;
export declare function resolvePeakEquity(accountId: number, currentEquity: number, startingBalance: number): Promise<number>;
export declare function getAccountCircuitStatus(accountId: number): Promise<CircuitStatus>;
/** Sticky pause when expectancy kill trips (idempotent if longer cooldown already set). */
export declare function applyExpectancyKillCooldownIfNeeded(accountId: number, status: CircuitStatus): Promise<void>;
//# sourceMappingURL=account-circuit.service.d.ts.map
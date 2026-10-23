import type { prisma } from '../lib/prisma';
export interface ClosedPositionMetricRow {
    position_id?: string | null;
    side?: string | null;
    close_reason?: string | null;
    realized_pnl?: number | null;
    r_multiple?: number | null;
    entry_fee?: number | null;
    exit_fee?: number | null;
    funding_fee?: number | null;
}
export interface ClosedTradeMetrics {
    totalTrades: number;
    wins: number;
    losses: number;
    breakeven: number;
    winRate: number;
    winRateAllClosed: number;
    grossProfit: number;
    grossLoss: number;
    positionPnl: number;
    storedFees: number;
    positionPnlAfterStoredFees: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number | null;
    avgRMultiple: number;
}
export interface AccountBalanceMetricRow {
    starting_balance: number;
    current_balance: number;
    equity: number;
}
export interface EquitySnapshotMetricRow {
    balance: number;
    equity: number;
    timestamp: Date;
}
export interface FullHistoryWalletMetrics {
    scope: 'full_history';
    baselineBalance: number;
    currentBalance: number;
    currentEquity: number;
    walletPnl: number;
    walletReturnPercent: number;
    peakEquity: number;
    peakEquityAt: Date | null;
    currentDrawdownPercent: number;
    maxDrawdownPercent: number;
    maxDrawdownAt: Date | null;
    firstSnapshotAt: Date | null;
    lastSnapshotAt: Date | null;
    snapshotCount: number;
}
/**
 * Reconciliation labels are not sufficient to identify bookkeeping rows: older
 * production closes can carry those labels while still containing verified
 * Binance PnL. Keep real PnL and only suppress zero-PnL internal/synthetic rows.
 */
export declare function isReportableClosedTrade(position: ClosedPositionMetricRow): boolean;
export declare function calculateClosedTradeMetrics(rows: ClosedPositionMetricRow[]): ClosedTradeMetrics;
export declare function calculateFullHistoryWalletMetrics(account: AccountBalanceMetricRow, snapshots: EquitySnapshotMetricRow[]): FullHistoryWalletMetrics;
export declare function getFullHistoryWalletMetrics(prismaClient: typeof prisma, account: AccountBalanceMetricRow & {
    id: number;
}): Promise<FullHistoryWalletMetrics>;
//# sourceMappingURL=account-performance.service.d.ts.map
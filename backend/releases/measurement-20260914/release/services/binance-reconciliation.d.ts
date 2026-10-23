/**
 * Binance reconciliation — keep local DB aligned with Binance (ONE_WAY).
 *
 * Rules (simple):
 * 1. Real-time fills are created by WebSocket; reconciliation can recover live unprotected exposure.
 * 2. Reconciliation fixes pending status and only materializes old fills when Binance still has live exposure.
 * 3. Open positions: at most one local row per symbol; align qty with Binance net.
 * 4. Absent on Binance: bookkeeping PnL=0 for phantom rows; proven fills resolve PnL + notify.
 * 5. Never resurrect closed or mislabeled rows (prevents 62k ghost shorts).
 * 6. Close open rows older than 6h when absent on Binance (stale ghosts).
 * 7. Reconciliation uses positionRisk only — never userTrades net for open/reopen/close skip.
 */
/**
 * Perform startup reconciliation between local DB and Binance
 *
 * This should be called when the backend starts up if BINANCE_ENABLED=true
 */
export declare function performStartupReconciliation(): Promise<void>;
/**
 * Cancel SL/TP algo orders when no matching open position on Binance.
 */
export declare function cleanupOrphanBinanceAlgoOrders(symbol?: string): Promise<number>;
/**
 * Initialize the startup reconciliation
 * This should be called when the backend starts
 */
export declare function initializeBinanceReconciliation(): Promise<void>;
/**
 * Stop periodic reconciliation polling
 */
export declare function stopPeriodicReconciliation(): void;
//# sourceMappingURL=binance-reconciliation.d.ts.map
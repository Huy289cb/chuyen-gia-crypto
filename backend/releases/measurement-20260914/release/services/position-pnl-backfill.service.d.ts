/**
 * Backfill close_price / realized_pnl / trade_outcomes for historical DB rows.
 */
export declare function calculatePositionPnl(side: string, entry: number, close: number, qty: number): number;
export declare function resolveBackfillClosePrice(position: {
    close_price: number | null;
    current_price: number;
    entry_price: number;
}): number;
export interface BackfillPositionResult {
    position_id: string;
    skipped: boolean;
    close_price?: number;
    realized_pnl?: number;
    outcome_stored?: boolean;
    reason?: string;
}
export interface BackfillRunSummary {
    scanned: number;
    updated: number;
    outcomes: number;
    skipped: number;
    dry_run: boolean;
    results: BackfillPositionResult[];
}
/**
 * Backfill one closed (or closing) position row without double-counting live closes.
 */
export declare function backfillClosedPositionPnl(position: {
    position_id: string;
    account_id: number;
    symbol: string;
    side: string;
    entry_price: number;
    entry_time: Date;
    current_price: number;
    close_price: number | null;
    close_time: Date | null;
    close_reason: string | null;
    size_qty: number;
    stop_loss: number;
    take_profit: number;
    expected_rr: number;
    risk_usd: number;
    entry_fee?: number;
    exit_fee?: number;
    funding_fee?: number;
    status: string;
    realized_pnl: number;
}, options?: {
    dryRun?: boolean;
}): Promise<BackfillPositionResult>;
/**
 * Recompute account trade counters from closed positions (after batch backfill).
 */
export declare function recomputeTestnetAccountTradeStats(accountId: number): Promise<void>;
/**
 * Backfill all closed positions for an account that lack PnL/close_price.
 */
export declare function runTestnetPnlBackfill(options?: {
    symbol?: string;
    methodId?: string;
    dryRun?: boolean;
}): Promise<BackfillRunSummary>;
//# sourceMappingURL=position-pnl-backfill.service.d.ts.map
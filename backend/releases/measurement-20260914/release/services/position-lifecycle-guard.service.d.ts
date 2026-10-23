/**
 * Central guards against premature Binance market closes and false bookkeeping closes
 * during fill → materialize → protective-order pipeline (deploy/restart races).
 */
export interface LifecycleDeferResult {
    defer: boolean;
    reason?: string;
}
export interface EmergencyMarketCloseContext {
    symbol: string;
    side: string;
    source: string;
    positionId?: string;
    entryTime?: Date | null;
}
export declare function markWorkerStarted(): void;
export declare function fillGraceMs(): number;
export declare function newPositionGraceMs(): number;
export declare function workerWarmupMs(): number;
export declare function emergencyCloseMemoryMs(): number;
export declare function protectiveAuditStartupDelayMs(): number;
export declare function isWorkerInWarmup(): boolean;
export declare function noteEmergencyMarketClose(symbol: string, side: string, source: string): void;
export declare function wasRecentEmergencyMarketClose(symbol: string, side: string, windowMs?: number): boolean;
export declare function findBlockingPendingForSymbol(symbol: string, side?: string): Promise<{
    symbol: string;
    id: number;
    account_id: number;
    realized_pnl: number | null;
    method_id: string;
    created_at: Date;
    entry_price: number;
    close_reason: string | null;
    side: string;
    stop_loss: number;
    take_profit: number;
    status: string;
    size_usd: number;
    size_qty: number;
    risk_usd: number;
    risk_percent: number;
    expected_rr: number;
    linked_prediction_id: number | null;
    binance_order_id: string | null;
    invalidation_level: number | null;
    order_id: string;
    executed_at: Date | null;
    executed_price: number | null;
    executed_size_qty: number | null;
    executed_size_usd: number | null;
    realized_pnl_percent: number | null;
} | null>;
export declare function findRecentlyExecutedPending(symbol: string, side?: string): Promise<{
    symbol: string;
    id: number;
    account_id: number;
    realized_pnl: number | null;
    method_id: string;
    created_at: Date;
    entry_price: number;
    close_reason: string | null;
    side: string;
    stop_loss: number;
    take_profit: number;
    status: string;
    size_usd: number;
    size_qty: number;
    risk_usd: number;
    risk_percent: number;
    expected_rr: number;
    linked_prediction_id: number | null;
    binance_order_id: string | null;
    invalidation_level: number | null;
    order_id: string;
    executed_at: Date | null;
    executed_price: number | null;
    executed_size_qty: number | null;
    executed_size_usd: number | null;
    realized_pnl_percent: number | null;
} | null>;
export declare function shouldDeferEmergencyMarketClose(input: EmergencyMarketCloseContext): Promise<LifecycleDeferResult>;
export declare function shouldDeferAbsentOnBinanceBookkeepingClose(position: {
    position_id: string;
    symbol: string;
    side: string;
    entry_time?: Date | null;
}): Promise<LifecycleDeferResult>;
/** Do not materialize an open row when Binance exposure is already gone (audit race). */
export declare function shouldSkipMaterializeWithoutLiveExposure(symbol: string, side: string): Promise<LifecycleDeferResult>;
//# sourceMappingURL=position-lifecycle-guard.service.d.ts.map
/**
 * Testnet Repository
 *
 * Handles all database operations for Binance Futures Testnet integration
 */
export interface TestnetAccountData {
    symbol: string;
    methodId: string;
    startingBalance: number;
}
export interface TestnetPositionData {
    positionId: string;
    accountId: number;
    symbol: string;
    side: string;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    sizeUsd: number;
    sizeQty: number;
    riskUsd: number;
    riskPercent: number;
    expectedRr: number;
    linkedPredictionId?: number;
    binanceOrderId?: string;
    binanceSlOrderId?: string;
    binanceTpOrderId?: string;
    tpLevels?: string;
    tpHitCount?: number;
    partialClosed?: number;
    entryFee?: number;
}
export interface TestnetPendingOrderData {
    orderId: string;
    accountId: number;
    symbol: string;
    side: string;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    sizeUsd: number;
    sizeQty: number;
    riskUsd: number;
    riskPercent: number;
    expectedRr: number;
    linkedPredictionId?: number;
    invalidationLevel?: number;
    methodId?: string;
    binanceOrderId?: string;
}
/**
 * Get or create testnet account
 */
export declare function getOrCreateTestnetAccount(symbol: string, methodId: string, startingBalance?: number): Promise<any>;
/**
 * Get testnet account
 */
export declare function getTestnetAccount(symbol: string, methodId: string): Promise<any | null>;
/**
 * Update testnet account balance
 */
export declare function updateTestnetAccountBalance(accountId: number, newBalance: number, pnl?: number): Promise<void>;
/**
 * Update testnet account equity directly
 */
export declare function updateTestnetAccountEquityDirect(accountId: number, totalWalletBalance: number): Promise<void>;
/**
 * Update trading fees
 */
export declare function updateTradingFees(accountId: number, feeAmount: number): Promise<void>;
/**
 * Update funding fee
 */
export declare function updateFundingFee(positionId: string, feeAmount: number, accountId?: number): Promise<void>;
/**
 * Update testnet account equity
 */
export declare function updateTestnetAccountEquity(accountId: number, unrealizedPnl: number): Promise<void>;
/**
 * Update testnet account stats
 */
export declare function updateTestnetAccountStats(accountId: number, isWin: boolean): Promise<void>;
/**
 * Check if should enter cooldown
 */
export declare function shouldEnterTestnetCooldown(accountId: number): Promise<{
    shouldCooldown: boolean;
    cooldownUntil?: string;
    consecutiveLosses?: number;
    reason?: string;
}>;
/**
 * Set cooldown timestamp
 */
export declare function setTestnetAccountCooldown(accountId: number, cooldownUntil: Date): Promise<void>;
/**
 * Create testnet position
 */
export declare function createTestnetPosition(data: TestnetPositionData): Promise<any>;
/** Statuses that still block new entries (open or wrongly reconciled). */
export declare const ACTIVE_TESTNET_POSITION_STATUSES: readonly ["open", "reconciliation_failed_not_on_binance"];
/**
 * Open or recoverable positions (blocks stacking).
 */
export declare function getActiveTestnetPositions(filters: {
    accountId?: number;
    symbol?: string;
    positionId?: string;
    methodId?: string;
    limit?: number;
}): Promise<any[]>;
export declare function findTestnetPositionByBinanceOrderId(binanceOrderId: string): Promise<{
    position_id: string;
} | null>;
/**
 * Get testnet positions
 */
export declare function getTestnetPositions(filters: {
    accountId?: number;
    symbol?: string;
    status?: string;
    positionId?: string;
    methodId?: string;
    limit?: number;
}): Promise<any[]>;
/**
 * Get testnet position by ID
 */
export declare function getTestnetPosition(positionId: string): Promise<any | null>;
/**
 * Update testnet position
 */
export declare function updateTestnetPosition(positionId: string, updates: Partial<any>): Promise<void>;
/**
 * Close testnet position
 */
export declare function closeTestnetPosition(positionId: string, closePrice: number, closeReason: string): Promise<void>;
/** Synthetic position for pipeline events (FK target for testnet_trade_events). */
export declare const PIPELINE_EVENT_POSITION_ID = "pipeline_v3_kim_nghia";
/**
 * Ensure a closed placeholder position exists so pipeline events can use the FK.
 */
export declare function ensurePipelineEventPosition(accountId: number): Promise<string>;
/**
 * Pipeline / LLM events without a real open position (execution_blocked, risk pre-check).
 */
export declare function recordPipelineEvent(eventType: string, eventData?: Record<string, unknown>): Promise<number | null>;
/** Persist high-volume observability events without Telegram side effects. */
export declare function recordSilentPipelineEvent(eventType: string, eventData?: Record<string, unknown>): Promise<number | null>;
/** Restart-safe dedup for JSON observations keyed by a stable bar/candidate key. */
export declare function hasSilentPipelineEventKey(eventType: string, jsonField: 'bar_key' | 'candidate_key' | 'observation_key', key: string): Promise<boolean>;
export declare function getSilentPipelineEvents(eventTypes: string[], since: Date): Promise<Array<{
    id: number;
    event_type: string;
    event_data: Record<string, unknown>;
    timestamp: Date;
}>>;
/**
 * Record testnet trade event (requires valid testnet_positions.position_id).
 */
export declare function recordTestnetTradeEvent(positionId: string, eventType: string, eventData?: Record<string, unknown>): Promise<number>;
/**
 * Get testnet trade events
 */
export declare function getTestnetTradeEvents(positionId: string): Promise<any[]>;
/**
 * Create testnet account snapshot
 */
export declare function createTestnetAccountSnapshot(accountId: number): Promise<number>;
/**
 * Get testnet account snapshots
 */
export declare function getTestnetAccountSnapshots(accountId: number, limit?: number): Promise<any[]>;
/**
 * Get testnet performance metrics
 */
export declare function getTestnetPerformanceMetrics(accountId: number): Promise<any>;
/**
 * Reset testnet account
 */
export declare function resetTestnetAccount(accountId: number): Promise<void>;
/**
 * Get testnet pending orders
 */
export declare function getTestnetPendingOrders(filters: {
    orderId?: string;
    symbol?: string;
    status?: string;
    accountId?: number;
    methodId?: string;
}): Promise<any[]>;
/** Pending rows that should block new limit placement until resolved on Binance. */
export declare const BLOCKING_PENDING_ORDER_STATUSES: readonly ["pending", "partially_filled", "reconciliation_failed_not_on_binance"];
export declare function getBlockingTestnetPendingOrders(filters: {
    symbol?: string;
    accountId?: number;
    methodId?: string;
}): Promise<any[]>;
/**
 * Find pending order by Binance order id (active or recoverable statuses).
 */
export declare function getTestnetPendingOrderByBinanceId(binanceOrderId: string, symbol?: string): Promise<any | null>;
/** Lookup by internal order_id (from clientOrderId x-v3_*). */
export declare function getTestnetPendingOrderByOrderId(orderId: string): Promise<any | null>;
/**
 * Execute testnet pending order
 */
export declare function executeTestnetPendingOrder(orderId: string, _positionId: string): Promise<void>;
/**
 * Cancel testnet pending order
 */
export declare function cancelTestnetPendingOrder(orderId: string, reason?: string): Promise<void>;
/**
 * Update testnet pending order
 */
export declare function updateTestnetPendingOrder(orderId: string, updates: Partial<any>): Promise<void>;
/**
 * Create testnet pending order
 */
export declare function createTestnetPendingOrder(data: TestnetPendingOrderData): Promise<any>;
/**
 * Update precision error tracking
 */
export declare function updatePrecisionError(accountId: number, errorCode: string, errorMessage: string): Promise<any>;
/**
 * Reset precision error tracking
 */
export declare function resetPrecisionErrorTracking(accountId: number): Promise<any>;
//# sourceMappingURL=testnet.repository.d.ts.map
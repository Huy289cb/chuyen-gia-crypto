/** Max |wallet − Σ position PnL| before DB position stats are hidden in UI. */
export declare const PNL_DB_GAP_TRUST_USD = 0.01;
export interface AccountBalanceSummary {
    isInitialized: boolean;
    symbol: string;
    methodId: string;
    totalBalance: number;
    availableBalance: number;
    equity: number;
    usedMargin: number;
    freeMargin: number;
    dailyPnL: number;
    weeklyPnL: number;
    openUnrealized: number;
    exposureUsd: number;
    maxExposureUsd: number;
    /** Wallet − starting_balance (Binance-aligned baseline). */
    walletPnl: number;
    /** account.realized_pnl from Binance income sync. */
    binanceRealizedPnl: number;
    /** Sum of closed position rows (may differ until fill backfill). */
    dbPositionPnlSum: number;
    /** walletPnl − dbPositionPnlSum (0 when aligned). */
    dbPositionPnlGap: number;
    positionTradingPnlGap: number;
    walletIncomeGap: number;
    /** True when gap is small enough to show per-position / DB win stats. */
    dbPositionPnlTrusted: boolean;
    /** Primary PnL label for UI: always wallet (Binance-aligned). */
    pnlSource: 'wallet';
    totalFees: number;
    fundingFees: number;
    startingBalance: number;
}
export interface TodayTradeStats {
    closedCount: number;
    wins: number;
    losses: number;
    totalRealizedPnl: number;
    totalFees: number;
    /** False when wallet vs DB closed-PnL gap exceeds trust threshold (DB path only). */
    fromDbPositions: boolean;
    /** Where closed-trade stats were loaded from. */
    source: 'db' | 'binance';
}
export declare function getAccountBalanceSummary(symbol: string, methodId: string, useIct?: boolean, refreshFromBinance?: boolean): Promise<AccountBalanceSummary>;
export declare function getTodayTradeStatsIct(symbol: string, methodId: string): Promise<TodayTradeStats>;
export interface OpenPositionLine {
    positionId: string;
    symbol: string;
    side: string;
    entry: number;
    mark: number;
    unrealizedPnl: number;
    sizeUsd: number;
    sizeQty: number;
    stopLoss?: number | null;
    takeProfit?: number | null;
    /** Local bookkeeping entry time when matched. */
    entryTime?: Date | null;
}
export interface PendingOrderLine {
    orderId: string;
    symbol: string;
    side: string;
    entry: number;
    status: string;
    quantity?: number;
    createdAt?: string;
    reduceOnly?: boolean;
}
export declare function getOpenPositionLines(symbol?: string, methodId?: string): Promise<OpenPositionLine[]>;
/** Open positions from Binance positionRisk (source of truth). */
export declare function getBinanceOpenPositionLines(symbol?: string): Promise<OpenPositionLine[]>;
/** Pending limit orders from Binance openOrders. */
export declare function getBinancePendingOrderLines(symbol?: string): Promise<PendingOrderLine[]>;
/** Prefer Binance live data when BINANCE_ENABLED. */
export declare function getLiveOpenPositionLines(symbol?: string, methodId?: string): Promise<OpenPositionLine[]>;
export declare function getLivePendingOrderLines(symbol?: string, methodId?: string): Promise<PendingOrderLine[]>;
/** Attach SL/TP from Binance open algo orders (same source as sàn). */
export declare function enrichPositionsWithBinanceSlTp(positions: OpenPositionLine[], symbol?: string): Promise<OpenPositionLine[]>;
export declare function getPendingOrderLines(symbol?: string, methodId?: string): Promise<PendingOrderLine[]>;
export declare function getDefaultTradingScope(): {
    symbol: string;
    methodId: string;
};
//# sourceMappingURL=account-summary.service.d.ts.map
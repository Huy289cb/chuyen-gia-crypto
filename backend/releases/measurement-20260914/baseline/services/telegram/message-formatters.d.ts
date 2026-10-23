export declare function escapeHtml(text: string): string;
export declare function fmtUsd(n: number | null | undefined, digits?: number): string;
export declare function fmtPct(n: number | null | undefined): string;
export declare function fmtPrice(n: number | null | undefined): string;
export declare function formatSideLabel(side: string | undefined): string | undefined;
export interface TradeNotifyPayload {
    title: string;
    symbol?: string;
    side?: string;
    timeframe?: string;
    entry?: number;
    closePrice?: number;
    stopLoss?: number;
    takeProfit?: number;
    sizeQty?: number;
    sizeUsd?: number;
    pnl?: number;
    accountBalance?: number;
    accountEquity?: number;
    reason?: string;
    extra?: Record<string, string | number | boolean | null | undefined>;
}
export declare function formatTradeNotify(p: TradeNotifyPayload): string;
export declare function formatAlert(title: string, body: string): string;
export declare function statusEmoji(ok: boolean): string;
export declare function schedulerIcon(status: string): string;
export interface CompactSchedulerRow {
    name: string;
    status: string;
    lastRun: string;
}
export interface CompactHealthInput {
    workerStatus: string;
    databaseStatus: string;
    safetyValidation: string;
    schedulers: CompactSchedulerRow[];
    warmupOk: boolean;
    riskLocked: boolean;
    lockReason: string | null;
    binanceEnabled: boolean;
    recentErrors: Array<{
        event_type: string;
        summary: string;
    }>;
}
export declare function formatSchedulerCompact(s: CompactSchedulerRow): string;
export declare function formatStatusSummary(h: CompactHealthInput): string;
export interface ShowSummaryInput {
    equity: number;
    totalBalance: number;
    dailyPnL: number;
    openCount: number;
    pendingCount: number;
    closedCount?: number;
    wins?: number;
    losses?: number;
    tradeStatsSource?: 'db' | 'binance';
    riskLocked: boolean;
    lockReason: string | null;
    notifyMuted: boolean;
    topError?: {
        event_type: string;
        summary: string;
    };
}
export declare function formatShowSummary(s: ShowSummaryInput): string;
export interface PipelineSummaryInput {
    schedulers: CompactSchedulerRow[];
    warmupOk: boolean;
    llmTotal: number;
    llmTrades: number;
    lastDecision?: {
        decision: string;
        reason: string | null;
        ago: string;
    };
}
export declare function formatPipelineSummary(p: PipelineSummaryInput): string;
export declare function formatOpenPositionForLenh(p: {
    symbol: string;
    side: string;
    sizeUsd: number;
    entry: number;
    mark: number;
    unrealizedPnl: number;
    stopLoss?: number | null;
    takeProfit?: number | null;
}): string;
export declare function formatEventSummary(eventType: string, summary: string, maxLen?: number): string;
export declare function mapTradeEventType(eventType: string): string | null;
//# sourceMappingURL=message-formatters.d.ts.map
import { type AccountBalanceSummary, type OpenPositionLine, type PendingOrderLine, type TodayTradeStats } from '../account-summary.service';
import { type SystemHealthSnapshot } from '../system-health.service';
export type BinanceExchangeMode = 'testnet' | 'mainnet';
export interface BinanceExchangeEnv {
    mode: BinanceExchangeMode;
    baseUrl: string;
    /** Where mark/last price for /lenh and openPositions comes from */
    markPriceSource: string;
    /** Plain note for /ai about demo vs mainnet price gaps */
    pricingNote: string;
}
export declare function getBinanceExchangeEnv(): BinanceExchangeEnv;
export type AiContextScope = 'today_run' | 'errors' | 'pipeline' | 'llm' | 'freeform' | 'compare';
export interface AiContextBundle {
    meta: {
        generatedAt: string;
        ictDate: string;
        symbol: string;
        methodId: string;
        scope: AiContextScope;
        binanceExchange: BinanceExchangeEnv;
    };
    account: AccountBalanceSummary;
    todayTrades: TodayTradeStats;
    weekTrades?: WeeklyTradeStats;
    health: SystemHealthSnapshot;
    llm: {
        stats: {
            total: number;
            trades: number;
            noTrades: number;
        };
        weekStats?: {
            total: number;
            trades: number;
            noTrades: number;
        };
        topNoTradeReasons: Array<{
            reason: string;
            count: number;
        }>;
    };
    /** Live Binance net position — authoritative for "có exposure không" */
    binanceExposure: BinanceExposureSnapshot;
    recentDecisions: TradeDecisionRow[];
    recentErrors: ErrorEventRow[];
    openPositions: OpenPositionLine[];
    pendingOrders: PendingOrderLine[];
    recentClosedPositions: RecentClosedPositionRow[];
    /** Plain-language rules for /ai — explain sync simply to operators */
    operatorNotes: string[];
}
export interface BinanceExposureSnapshot {
    available: boolean;
    side: 'long' | 'short' | 'flat' | 'unknown';
    netQty: number;
    entryPrice?: number;
    markPrice?: number;
    note?: string;
}
export interface RecentClosedPositionRow {
    position_id: string;
    side: string;
    entry_price: number;
    close_price: number;
    realized_pnl: number;
    close_reason: string;
    entry_time: string;
    close_time: string;
}
export interface WeeklyTradeStats {
    closedCount: number;
    wins: number;
    losses: number;
    totalRealizedPnl: number;
    totalFees: number;
}
export interface TradeDecisionRow {
    id: number;
    decision: string;
    grade: string;
    confidence: number;
    timeframe: string;
    reason: string;
    timestamp: string;
}
export interface ErrorEventRow {
    event_type: string;
    timestamp: string;
    summary: string;
}
export declare function redactSensitiveText(text: string): string;
export declare function getWeeklyTradeStatsIct(symbol: string, methodId: string): Promise<WeeklyTradeStats>;
export declare function buildAiContext(scope: AiContextScope): Promise<AiContextBundle>;
export declare function contextToJson(bundle: AiContextBundle): string;
export interface ParsedAiCommand {
    action: 'analyze' | 'cancel';
    scope: AiContextScope;
    question?: string;
}
export declare function parseAiCommandArgs(args: string): ParsedAiCommand;
export declare function splitMessageForTelegram(text: string, maxLen?: number): string[];
//# sourceMappingURL=ai-context.builder.d.ts.map
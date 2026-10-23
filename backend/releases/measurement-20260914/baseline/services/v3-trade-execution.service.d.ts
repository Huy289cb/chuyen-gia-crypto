/**
 * V3 trade execution — places Binance testnet limit orders and records pending orders.
 * Position is created only after WebSocket fill (binance-websocket-sync).
 */
import type { GroqAnalysis } from './groq-client';
export interface V3TradeExecutionInput {
    symbol: string;
    timeframe: string;
    analysis: GroqAnalysis;
    methodId?: string;
    /** trade_decisions.id from LLM dispatch — links outcome on close */
    decisionRecordId?: number;
    /** Setup-specific minimum R:R (for example range retest uses 1.5 instead of method default). */
    requiredMinRr?: number;
}
export interface MinimumLotLevelAdjustment {
    originalStopLoss: number;
    originalTakeProfit: number;
    stopLoss: number;
    takeProfit: number;
    originalStopPercent: number;
    normalizedStopPercent: number;
    effectiveRiskPercent: number;
}
export interface V3TradeExecutionResult {
    success: boolean;
    orderId?: string;
    binanceOrderId?: string;
    reason: string;
    levelAdjustment?: MinimumLotLevelAdjustment;
}
/**
 * Execute an LLM-approved trade on Binance testnet (limit entry + pending order row).
 */
export declare function executeV3Trade(input: V3TradeExecutionInput): Promise<V3TradeExecutionResult>;
//# sourceMappingURL=v3-trade-execution.service.d.ts.map
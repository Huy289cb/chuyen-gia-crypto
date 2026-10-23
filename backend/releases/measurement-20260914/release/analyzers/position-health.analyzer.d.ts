/**
 * Position Health Analyzer
 * Analyzes open positions to determine health status
 * Used by position monitor to decide on HOLD / REDUCE / EXIT actions
 */
export interface PositionData {
    position_id: string;
    symbol: string;
    side: 'long' | 'short';
    entry_price: number;
    current_price: number;
    stop_loss: number;
    take_profit: number;
    entry_time: Date;
    size_qty: number;
    unrealized_pnl: number;
}
export interface PositionHealthResult {
    health: 'healthy' | 'warning' | 'critical';
    pnl_percent: number;
    time_in_position_minutes: number;
    distance_to_sl_percent: number;
    distance_to_tp_percent: number;
    /** 0 = at entry, 1 = at SL (fraction of entry→SL range consumed). */
    sl_progress: number | null;
    recommended_action: 'hold' | 'reduce' | 'exit';
    reason: string;
}
export interface PositionHealthOptions {
    /** Cumulative fraction already closed by monitor (0–1). Blocks repeat REDUCE. */
    partial_closed?: number;
    /** When set, monitor defers to exchange SL/TP — no discretionary reduce/exit. */
    exchange_sl_tp_active?: boolean;
    /** Minimum minutes in trade before monitor may act. */
    min_minutes_before_action?: number;
    /** Minimum |pnl%| before discretionary reduce (not SL-progress exit). */
    min_pnl_percent_for_action?: number;
}
/** Fraction of entry→SL distance consumed (0 at entry, 1 at SL). */
export declare function computeSlProgress(position: PositionData): number | null;
/**
 * Analyze position health
 */
export declare function analyzePositionHealth(position: PositionData, options?: PositionHealthOptions): PositionHealthResult;
/**
 * Check if position should be reversed
 * Only reverse if new valid setup exists (to be called from LLM dispatch)
 */
export declare function shouldReversePosition(position: PositionData, newSetupBias: 'bullish' | 'bearish' | 'neutral'): boolean;
//# sourceMappingURL=position-health.analyzer.d.ts.map
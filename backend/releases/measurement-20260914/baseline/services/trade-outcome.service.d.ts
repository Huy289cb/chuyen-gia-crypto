/**
 * Persist trade_outcomes on every confirmed close for edge measurement.
 */
export interface CloseOutcomeContext {
    position_id: string;
    symbol: string;
    side: string;
    entry_price: number;
    entry_time: Date;
    stop_loss: number;
    take_profit: number;
    expected_rr: number;
    risk_usd: number;
    entry_fee?: number;
    exit_fee?: number;
    funding_fee?: number;
    close_reason: string;
    decision_id?: number;
    fill_verified?: boolean;
    close_time?: Date;
    strict_link?: boolean;
}
export interface RecordOutcomeOptions {
    skipReflection?: boolean;
}
/**
 * Resolve trade_decision id for a closed position (no schema migration required).
 */
export declare function resolveDecisionIdForPosition(ctx: CloseOutcomeContext): Promise<number | null>;
/**
 * Record trade_outcome + playbook stats after a confirmed close.
 */
export declare function recordTradeOutcomeOnClose(ctx: CloseOutcomeContext, closePrice: number, realizedPnl: number, options?: RecordOutcomeOptions): Promise<void>;
//# sourceMappingURL=trade-outcome.service.d.ts.map
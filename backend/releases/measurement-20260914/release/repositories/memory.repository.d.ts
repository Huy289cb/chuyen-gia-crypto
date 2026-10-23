/**
 * Memory Repository
 * Handles database operations for trade decisions, outcomes, reflections, and playbook stats
 */
export interface TradeDecisionInput {
    symbol: string;
    timeframe: string;
    playbook_key: string;
    grade: string;
    confidence: number;
    regime: string;
    decision: string;
    reason: string;
    entry_price?: number;
    stop_loss?: number;
    take_profit?: number;
    expected_rr?: number;
    candle_hash?: string;
    method_id?: string;
}
export interface TradeOutcomeInput {
    decision_id: number;
    symbol: string;
    outcome: string;
    entry_price: number;
    exit_price: number;
    realized_pnl: number;
    realized_rr: number;
    execution_cost?: number;
    duration_minutes?: number;
    close_reason: string;
}
export interface TradeReflectionInput {
    outcome_id: number;
    symbol: string;
    what_went_wrong?: string;
    what_worked?: string;
    lesson_learned?: string;
}
export interface PlaybookStatsInput {
    playbook_key: string;
    symbol: string;
}
/**
 * Store a trade decision
 */
export declare function findTradeDecisionForBar(symbol: string, timeframe: string, candle_hash: string, method_id: string): Promise<{
    symbol: string;
    timestamp: Date;
    timeframe: string;
    id: number;
    method_id: string;
    reason: string;
    entry_price: number | null;
    decision: string;
    stop_loss: number | null;
    take_profit: number | null;
    expected_rr: number | null;
    confidence: number;
    playbook_key: string;
    grade: string;
    regime: string;
    candle_hash: string | null;
} | null>;
export declare function storeTradeDecision(input: TradeDecisionInput): Promise<{
    symbol: string;
    timestamp: Date;
    timeframe: string;
    id: number;
    method_id: string;
    reason: string;
    entry_price: number | null;
    decision: string;
    stop_loss: number | null;
    take_profit: number | null;
    expected_rr: number | null;
    confidence: number;
    playbook_key: string;
    grade: string;
    regime: string;
    candle_hash: string | null;
}>;
export declare function updateTradeDecisionReason(id: number, reason: string): Promise<{
    symbol: string;
    timestamp: Date;
    timeframe: string;
    id: number;
    method_id: string;
    reason: string;
    entry_price: number | null;
    decision: string;
    stop_loss: number | null;
    take_profit: number | null;
    expected_rr: number | null;
    confidence: number;
    playbook_key: string;
    grade: string;
    regime: string;
    candle_hash: string | null;
}>;
/**
 * Store a trade outcome
 */
export declare function storeTradeOutcome(input: TradeOutcomeInput): Promise<{
    symbol: string;
    timestamp: Date;
    id: number;
    realized_pnl: number;
    decision_id: number;
    outcome: string;
    entry_price: number;
    exit_price: number;
    realized_rr: number;
    execution_cost: number;
    duration_minutes: number | null;
    close_reason: string;
}>;
/**
 * Store a trade reflection
 */
export declare function storeTradeReflection(input: TradeReflectionInput): Promise<{
    symbol: string;
    timestamp: Date;
    id: number;
    outcome_id: number;
    what_went_wrong: string | null;
    what_worked: string | null;
    lesson_learned: string | null;
}>;
/**
 * Get recent trade decisions for a symbol
 */
export declare function getRecentTradeDecisions(symbol: string, limit?: number): Promise<({
    trade_outcome: ({
        reflection: {
            symbol: string;
            timestamp: Date;
            id: number;
            outcome_id: number;
            what_went_wrong: string | null;
            what_worked: string | null;
            lesson_learned: string | null;
        } | null;
    } & {
        symbol: string;
        timestamp: Date;
        id: number;
        realized_pnl: number;
        decision_id: number;
        outcome: string;
        entry_price: number;
        exit_price: number;
        realized_rr: number;
        execution_cost: number;
        duration_minutes: number | null;
        close_reason: string;
    }) | null;
} & {
    symbol: string;
    timestamp: Date;
    timeframe: string;
    id: number;
    method_id: string;
    reason: string;
    entry_price: number | null;
    decision: string;
    stop_loss: number | null;
    take_profit: number | null;
    expected_rr: number | null;
    confidence: number;
    playbook_key: string;
    grade: string;
    regime: string;
    candle_hash: string | null;
})[]>;
/**
 * Get similar trades by playbook and regime
 */
export declare function getSimilarTrades(playbook_key: string, regime: string, symbol: string, limit?: number): Promise<({
    trade_outcome: {
        symbol: string;
        timestamp: Date;
        id: number;
        realized_pnl: number;
        decision_id: number;
        outcome: string;
        entry_price: number;
        exit_price: number;
        realized_rr: number;
        execution_cost: number;
        duration_minutes: number | null;
        close_reason: string;
    } | null;
} & {
    symbol: string;
    timestamp: Date;
    timeframe: string;
    id: number;
    method_id: string;
    reason: string;
    entry_price: number | null;
    decision: string;
    stop_loss: number | null;
    take_profit: number | null;
    expected_rr: number | null;
    confidence: number;
    playbook_key: string;
    grade: string;
    regime: string;
    candle_hash: string | null;
})[]>;
/**
 * Get recent failures (losses) for a symbol
 */
export declare function getRecentFailures(symbol: string, limit?: number): Promise<({
    decision: {
        symbol: string;
        timestamp: Date;
        timeframe: string;
        id: number;
        method_id: string;
        reason: string;
        entry_price: number | null;
        decision: string;
        stop_loss: number | null;
        take_profit: number | null;
        expected_rr: number | null;
        confidence: number;
        playbook_key: string;
        grade: string;
        regime: string;
        candle_hash: string | null;
    };
    reflection: {
        symbol: string;
        timestamp: Date;
        id: number;
        outcome_id: number;
        what_went_wrong: string | null;
        what_worked: string | null;
        lesson_learned: string | null;
    } | null;
} & {
    symbol: string;
    timestamp: Date;
    id: number;
    realized_pnl: number;
    decision_id: number;
    outcome: string;
    entry_price: number;
    exit_price: number;
    realized_rr: number;
    execution_cost: number;
    duration_minutes: number | null;
    close_reason: string;
})[]>;
/** Closed trades with reflections for LLM learning (same symbol). */
export declare function getRecentOutcomesWithReflection(symbol: string, limit?: number): Promise<({
    decision: {
        timeframe: string;
        reason: string;
        playbook_key: string;
        regime: string;
    };
    reflection: {
        symbol: string;
        timestamp: Date;
        id: number;
        outcome_id: number;
        what_went_wrong: string | null;
        what_worked: string | null;
        lesson_learned: string | null;
    } | null;
} & {
    symbol: string;
    timestamp: Date;
    id: number;
    realized_pnl: number;
    decision_id: number;
    outcome: string;
    entry_price: number;
    exit_price: number;
    realized_rr: number;
    execution_cost: number;
    duration_minutes: number | null;
    close_reason: string;
})[]>;
/**
 * Get or create playbook stats
 */
export declare function getPlaybookStats(playbook_key: string, symbol: string): Promise<{
    symbol: string;
    id: number;
    total_trades: number;
    winning_trades: number;
    losing_trades: number;
    playbook_key: string;
    win_rate: number;
    avg_rr: number;
    avg_pnl: number;
    total_pnl: number;
    last_updated: Date;
}>;
/**
 * Update playbook stats after a trade
 */
export declare function updatePlaybookStats(playbook_key: string, symbol: string, outcome: string, pnl: number, rr: number): Promise<{
    symbol: string;
    id: number;
    total_trades: number;
    winning_trades: number;
    losing_trades: number;
    playbook_key: string;
    win_rate: number;
    avg_rr: number;
    avg_pnl: number;
    total_pnl: number;
    last_updated: Date;
}>;
/**
 * Get all playbook stats for a symbol
 */
export declare function getAllPlaybookStats(symbol: string): Promise<{
    symbol: string;
    id: number;
    total_trades: number;
    winning_trades: number;
    losing_trades: number;
    playbook_key: string;
    win_rate: number;
    avg_rr: number;
    avg_pnl: number;
    total_pnl: number;
    last_updated: Date;
}[]>;
//# sourceMappingURL=memory.repository.d.ts.map
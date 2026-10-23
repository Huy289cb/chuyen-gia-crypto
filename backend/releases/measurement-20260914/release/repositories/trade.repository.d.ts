/**
 * Trade Repository
 * Handles database operations for trade-related data
 * This is a placeholder for future trade-specific operations
 * that may be separate from the memory system
 */
/**
 * Get trade decision by ID
 */
export declare function getTradeDecisionById(id: number): Promise<({
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
}) | null>;
/**
 * Get trade outcome by decision ID
 */
export declare function getTradeOutcomeByDecisionId(decisionId: number): Promise<({
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
}) | null>;
/**
 * Get all trade decisions for a method
 */
export declare function getTradeDecisionsByMethod(methodId: string, limit?: number): Promise<({
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
 * Get trade decisions filtered by grade
 */
export declare function getTradeDecisionsByGrade(grade: string, limit?: number): Promise<({
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
 * Get no-trade decisions
 */
export declare function getNoTradeDecisions(symbol: string, limit?: number): Promise<{
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
}[]>;
/**
 * Get trade decisions within a date range
 */
export declare function getTradeDecisionsByDateRange(symbol: string, startDate: Date, endDate: Date): Promise<({
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
//# sourceMappingURL=trade.repository.d.ts.map
/**
 * Memory Service
 * Stores and retrieves trading decisions, outcomes, and reflections
 * Builds context for LLM to learn from past trades
 */
export interface DecisionInput {
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
export interface OutcomeInput {
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
export interface ReflectionInput {
    outcome_id: number;
    symbol: string;
    what_went_wrong?: string;
    what_worked?: string;
    lesson_learned?: string;
}
export interface MemoryContext {
    similar_trades: any[];
    recent_failures: any[];
    playbook_stats: any;
    current_winrate: number;
}
/**
 * Memory Service
 */
export declare class MemoryService {
    /**
     * Store a trading decision
     */
    storeDecision(input: DecisionInput): Promise<{
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
    /** Existing decision for this candle bar (LLM dedup before Groq call). */
    findDecisionForBar(symbol: string, timeframe: string, candle_hash: string, method_id?: string): Promise<{
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
    /** After LLM approved trade but Binance/order path failed */
    recordExecutionBlocked(decisionId: number, _symbol: string, summaryLine: string, blockReason: string): Promise<void>;
    /**
     * Store a trade outcome
     */
    storeOutcome(input: OutcomeInput): Promise<{
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
    storeReflection(input: ReflectionInput): Promise<{
        symbol: string;
        timestamp: Date;
        id: number;
        outcome_id: number;
        what_went_wrong: string | null;
        what_worked: string | null;
        lesson_learned: string | null;
    }>;
    /**
     * Generate reflection automatically based on outcome
     */
    generateReflection(outcomeId: number, outcome: string, pnl: number): Promise<{
        symbol: string;
        timestamp: Date;
        id: number;
        outcome_id: number;
        what_went_wrong: string | null;
        what_worked: string | null;
        lesson_learned: string | null;
    }>;
    /**
     * Build context for LLM based on current setup
     */
    buildContextForLLM(symbol: string, playbook_key: string, regime: string): Promise<MemoryContext>;
    /**
     * Format memory context for LLM prompt
     */
    formatContextForPrompt(context: MemoryContext): string;
    /**
     * Recent trade reflections for groq dispatch / pending review (TradingAgents-style learning).
     */
    formatRecentReflectionsForPrompt(symbol: string): Promise<string>;
    /**
     * Analyze loss reason (simple heuristic)
     */
    private analyzeLossReason;
    /**
     * Analyze win reason (simple heuristic)
     */
    private analyzeWinReason;
    /**
     * Generate lesson from outcome
     */
    private generateLesson;
    /**
     * Get playbook performance summary
     */
    getPlaybookPerformance(symbol: string): Promise<{
        playbook_key: any;
        total_trades: any;
        win_rate: any;
        avg_rr: any;
        avg_pnl: any;
        total_pnl: any;
        last_updated: any;
    }[]>;
}
export declare const memoryService: MemoryService;
//# sourceMappingURL=memory.service.d.ts.map
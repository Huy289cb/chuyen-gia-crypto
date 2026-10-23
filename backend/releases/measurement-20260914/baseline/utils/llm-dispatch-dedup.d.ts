/**
 * Reconstruct Groq dispatch output from a stored trade_decisions row.
 * Used to skip duplicate LLM calls for the same candle bar.
 */
import type { TradeDecision } from '@prisma/client';
import type { GroqAnalysis } from '../services/groq-client';
export interface StoredDecisionDispatchOutput {
    decision: 'trade' | 'no_trade';
    analysis?: GroqAnalysis;
    reason: string;
    decisionRecordId?: number;
}
/**
 * A stored trade is an LLM-result cache hit, not an execution authorization.
 * It must pass all current live hard gates again before it can be returned.
 */
export declare function shouldRevalidateStoredTrade(output: StoredDecisionDispatchOutput): output is StoredDecisionDispatchOutput & {
    decision: 'trade';
    analysis: GroqAnalysis;
};
export declare function parseActionFromStoredReason(reason: string): 'buy' | 'sell' | 'hold' | null;
export declare function analysisFromStoredDecision(row: TradeDecision): GroqAnalysis | undefined;
export declare function buildDispatchOutputFromStoredDecision(row: TradeDecision): StoredDecisionDispatchOutput;
//# sourceMappingURL=llm-dispatch-dedup.d.ts.map
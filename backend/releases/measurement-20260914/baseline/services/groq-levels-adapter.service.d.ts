/**
 * Secondary Groq pass (GROQ_API_KEY_2):
 * - Min SL fail → widen SL + TP (`tryRepairLevelsWithSecondaryKey`).
 * - SL OK but R:R low → adjust TP only (`tryRepairTpForMinRrWithSecondaryKey`, Step 5b).
 * Invoked only when GROQ_LEVELS_ADAPTER_ENABLED=true and key 2 is set.
 */
import type { GroqAnalysis } from './groq-client';
export declare function isLevelsAdapterConfigured(): boolean;
/** @deprecated use isLevelsAdapterConfigured */
export declare function isGroqLevelsAdapterConfigured(): boolean;
/** Exported for prompt regression tests. */
export declare function buildAdapterPrompts(input: {
    symbol: string;
    timeframe: string;
    action: 'buy' | 'sell';
    entry: number;
    sl: number;
    tp: number;
    minSlPct: number;
    minRr: number;
}): {
    systemPrompt: string;
    userPrompt: string;
};
/** Exported for prompt regression tests. */
export declare function buildRrOnlyTpAdapterPrompts(input: {
    symbol: string;
    timeframe: string;
    action: 'buy' | 'sell';
    entry: number;
    sl: number;
    tp: number;
    minSlPct: number;
    minRr: number;
    currentRr: number;
}): {
    systemPrompt: string;
    userPrompt: string;
};
/**
 * If primary analysis fails min SL, ask secondary key to propose wider SL + compatible TP.
 * Returns updated analysis or null (caller keeps no_trade path).
 */
export declare function tryRepairLevelsWithSecondaryKey(input: {
    symbol: string;
    timeframe: string;
    methodId: string;
    analysis: GroqAnalysis;
}): Promise<GroqAnalysis | null>;
/**
 * When SL passes min distance but price-derived R:R is below method minimum, ask key2 for a new TP only.
 * SL from primary analysis is preserved.
 */
export declare function tryRepairTpForMinRrWithSecondaryKey(input: {
    symbol: string;
    timeframe: string;
    methodId: string;
    analysis: GroqAnalysis;
}): Promise<GroqAnalysis | null>;
//# sourceMappingURL=groq-levels-adapter.service.d.ts.map
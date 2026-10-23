/**
 * When a new LLM entry opposes open Binance exposure, evaluate early close (flip) via Groq.
 */
import type { GroqAnalysis } from './groq-client';
import type { LocalSide } from './v3-entry-eligibility.service';
export interface OppositeFlipInput {
    symbol: string;
    methodId: string;
    newSide: LocalSide;
    analysis: GroqAnalysis;
    timeframe: string;
}
export interface OppositeFlipResult {
    flipped: boolean;
    reason: string;
}
export declare function tryOppositeFlipBeforeEntry(input: OppositeFlipInput): Promise<OppositeFlipResult>;
//# sourceMappingURL=opposite-flip.service.d.ts.map
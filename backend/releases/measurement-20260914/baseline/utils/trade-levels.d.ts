import type { GroqAnalysis } from '../services/groq-client';
/**
 * Risk:reward from entry / stop / target prices (reward ÷ risk).
 */
export declare function computeExpectedRrFromPrices(entry: number, stopLoss: number, takeProfit: number): number | null;
export interface RrReconcileResult {
    analysis: GroqAnalysis;
    computedRr: number | null;
    llmClaimedRr: number | null;
    rrCorrected: boolean;
}
/**
 * Overwrite expected_rr with price-derived R:R; warn when LLM claim diverges.
 */
export declare function formatPriceLevel(value: number | null | undefined): string;
/** One-line summary for event log / trade_decisions */
export declare function formatLlmTradeSummary(analysis: {
    action?: string;
    confidence?: number;
    suggested_entry?: number;
    suggested_stop_loss?: number;
    suggested_take_profit?: number;
}): string;
/**
 * Minimum-distance SL + TP at min R:R from entry (policy math — does not rely on LLM arithmetic).
 */
export declare function computePolicyCompliantStopAndTarget(input: {
    action: 'buy' | 'sell';
    entry: number;
    minSlPct: number;
    minRr: number;
}): {
    stopLoss: number;
    takeProfit: number;
} | null;
/** Minimum TP price for a fixed entry/SL to satisfy min R:R (reward/risk). */
export declare function computeMinTakeProfitForRr(input: {
    action: 'buy' | 'sell';
    entry: number;
    stopLoss: number;
    minRr: number;
}): number | null;
/** Cent-rounded prices + IEEE float can sit ~1 ULP below policy min (e.g. 0.80% → 0.799999…). */
export declare const MIN_SL_DISTANCE_EPS_RATIO = 0.000001;
export declare function checkMinSlDistance(entry: number, stopLoss: number, minPct: number): {
    ok: boolean;
    distancePct: number;
    minPct: number;
};
export declare function reconcileExpectedRr(analysis: GroqAnalysis): RrReconcileResult;
//# sourceMappingURL=trade-levels.d.ts.map
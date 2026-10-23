/**
 * Pure position invalidation scoring (no I/O).
 * Thesis dead (score≥min) → exit. No BE tighten — entry is not market structure.
 * docs/position-invalidation-plan.md §5
 */
export type InvalidationSide = 'long' | 'short';
export interface InvalidationScanSnap {
    timeframe: string;
    regime: 'trend' | 'range' | 'chop' | string;
    trendDirection?: 'bullish' | 'bearish' | null;
    /** Playbook evidence rows from setup gate. */
    playbooks?: Array<{
        playbook: string;
        detected: boolean;
        grade: string;
        summary?: string;
        metrics?: Record<string, string | number | boolean | null>;
    }>;
}
export interface InvalidationInput {
    side: InvalidationSide;
    entry: number;
    mark: number;
    currentSl: number;
    ageMinutes: number;
    initialRisk?: number;
    htf?: InvalidationScanSnap | null;
    ltf?: InvalidationScanSnap | null;
    minScore: number;
    minAgeMinutes: number;
    /** Kept for API compat; exit no longer gated on green uPnL. */
    minUpnlPct: number;
    htfLostMinHours: number;
    /** @deprecated Ignored — invalidation no longer tightens to BE. */
    beFeeBufferPct?: number;
    /** When score≥min, market-exit (green or red). */
    allowExitWhenRed?: boolean;
}
export interface InvalidationSignal {
    id: string;
    weight: number;
    detail: string;
}
export interface InvalidationResult {
    action: 'hold' | 'exit';
    score: number;
    signals: InvalidationSignal[];
    reason: string;
    unrealizedPct: number;
}
export declare function evaluatePositionInvalidation(input: InvalidationInput): InvalidationResult;
//# sourceMappingURL=position-invalidation.d.ts.map
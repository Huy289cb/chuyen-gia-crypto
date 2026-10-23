/**
 * Signal Gate Service
 * Determines whether to proceed to LLM analysis based on setup quality
 * Reduces Groq usage by filtering out weak signals before LLM call
 */
import { SetupGateInput, SetupGateResult } from '../analyzers/setup-gate.analyzer';
import type { MarketRegime } from '../analyzers/market-regime.analyzer';
export interface SignalGateConfig {
    minGrade: 'A' | 'B' | 'C' | 'D';
    minConfidence: number;
    allowedRegimes: ('trend' | 'range' | 'chop')[];
    enableDuplicateFilter: boolean;
}
export interface SignalGateOutput {
    pass: boolean;
    setupResult: SetupGateResult;
    reason: string;
    shouldCallGroq: boolean;
    /** True when this evaluation reused in-memory cache (not a fresh setup read). */
    isDuplicate: boolean;
    /** Regime used for pass/fail (may follow HTF when LTF aligned). */
    gateRegime?: MarketRegime;
}
export interface SignalGateEvaluateInput extends SetupGateInput {
    /** HTF regime from earlier scan in same cycle (e.g. 1h trend for 5m/15m). */
    htfRegime?: MarketRegime | null;
}
export interface CandleData {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timestamp: number;
}
/**
 * Signal Gate Service
 * Evaluates whether a signal is strong enough to proceed to LLM analysis
 */
export declare class SignalGateService {
    private config;
    constructor(config?: Partial<SignalGateConfig>);
    /**
     * Evaluate signal and determine if it should proceed to LLM
     */
    evaluate(input: SignalGateEvaluateInput): Promise<SignalGateOutput>;
    private resolveGateRegime;
    /**
     * Check if grade meets minimum requirement
     */
    private isGradeAcceptable;
    /**
     * Update configuration
     */
    updateConfig(config: Partial<SignalGateConfig>): void;
    /**
     * Get current configuration
     */
    getConfig(): SignalGateConfig;
    /**
     * Clear signal cache
     */
    clearCache(): void;
}
export declare const signalGateService: SignalGateService;
//# sourceMappingURL=signal-gate.service.d.ts.map
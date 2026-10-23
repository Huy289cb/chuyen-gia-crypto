/**
 * Groq Dispatch Service
 * Orchestrates LLM calls with strict validation and memory context
 * Only calls Groq when signal gate and risk engine approve
 */
import { GroqAnalysis } from './groq-client';
import { MemoryContext } from './memory.service';
import { type SignalGateOutput } from './signal-gate.service';
import { type UnifiedCandle } from './candle.service';
import { type RetestDispatchContext } from '../utils/adaptive-retest-dispatch';
export interface GroqDispatchInput {
    symbol: string;
    timeframe: string;
    candles: UnifiedCandle[];
    systemPrompt: string;
    method_id?: string;
    /** Precomputed by MarketScan — avoids second signal-gate evaluation */
    signalResult?: SignalGateOutput;
    /**
     * A previously valid breakout which has now retested its boundary. The side
     * comes from immutable breakout evidence because the retest bar itself is no
     * longer expected to classify as a breakout.
     */
    retestContext?: RetestDispatchContext;
}
export interface GroqDispatchOutput {
    decision: 'trade' | 'no_trade';
    analysis?: GroqAnalysis;
    reason: string;
    memory_context?: MemoryContext;
    /** DB row id when memory stored the decision */
    decisionRecordId?: number;
}
export interface GroqDispatchConfig {
    enableMemory: boolean;
    enableSignalGate: boolean;
    enableRiskCheck: boolean;
    maxRetries: number;
}
/**
 * Groq Dispatch Service
 */
export declare class GroqDispatchService {
    private config;
    constructor(config?: Partial<GroqDispatchConfig>);
    /**
     * Main dispatch method - evaluates whether to call Groq and executes if approved
     */
    dispatch(input: GroqDispatchInput): Promise<GroqDispatchOutput>;
    /**
     * Call Groq with strict validation and retry logic
     */
    private callGroqWithValidation;
    /**
     * Unwrap symbol-keyed payloads ({ "btc": { ... } }) from Kim Nghia / ICT prompts.
     */
    private normalizeGroqAnalysis;
    /**
     * Validate Groq response structure
     */
    private validateResponse;
    /**
     * Build base prompt from candle data
     */
    private buildBasePrompt;
    /**
     * Update configuration
     */
    updateConfig(config: Partial<GroqDispatchConfig>): void;
    /**
     * Get current configuration
     */
    getConfig(): GroqDispatchConfig;
}
export declare const groqDispatchService: GroqDispatchService;
//# sourceMappingURL=groq-dispatch.service.d.ts.map
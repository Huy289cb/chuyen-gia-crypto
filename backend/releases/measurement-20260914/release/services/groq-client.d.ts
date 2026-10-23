import { escapeControlCharsInJsonStrings as escapeControlCharsInJsonStringsImpl } from '../utils/llm-json';
export interface GroqAnalysisRequest {
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
    maxRetries?: number;
    /** If set, only these models are tried (in order). Saves cost for auxiliary calls (e.g. levels adapter). */
    preferredModels?: string[];
}
export interface GroqTextRequest {
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
    maxTokens?: number;
    maxRetries?: number;
    preferredModels?: string[];
}
export interface GroqAnalysis {
    bias: string;
    action: string;
    confidence: number;
    suggested_entry?: number;
    suggested_stop_loss?: number;
    suggested_take_profit?: number;
    expected_rr?: number;
    invalidation_level?: number;
    position_decisions?: any[];
    pending_order_decisions?: any[];
    reason_summary?: string;
    [key: string]: any;
}
/** Re-export for existing unit tests / callers. */
export declare const escapeControlCharsInJsonStrings: typeof escapeControlCharsInJsonStringsImpl;
/** Clean + repair LLM JSON (OpenRouter-heavy failure modes). Truncated → null. */
export declare function cleanJSONResponse(rawResponse: string): GroqAnalysis | null;
export declare function validateAIResponse(response: any, symbol: string): boolean;
declare class GroqClient {
    private apiKeys;
    private currentKeyIndex;
    private baseUrl;
    constructor(apiKeys: string | string[]);
    getCurrentApiKey(): string;
    switchToNextApiKey(): void;
    resetToFirstApiKey(): void;
    /**
     * Try a subset of Groq models across all API keys. Returns null when every key/model fails.
     */
    private tryGroqModels;
    private tryOpenRouterDispatch;
    private tryCerebrasDispatch;
    /**
     * Dispatch order:
     * - LLM_PROVIDER=openrouter (mainnet): OpenRouter Scout → Groq production
     *   models → Cerebras (optional last resort).
     * - default groq: Groq → Cerebras → OpenRouter → Groq fallbacks
     */
    private analyzeDispatchChain;
    /**
     * Send chat completion request to Groq API
     */
    analyze(params: GroqAnalysisRequest): Promise<GroqAnalysis>;
    /**
     * Plain-text completion for ops Q&A (Telegram AI). No JSON parsing.
     */
    completeText(params: GroqTextRequest): Promise<string>;
    /**
     * Check if API key is valid by making a test request
     */
    validateKey(): Promise<boolean>;
}
export declare function createGroqClient(apiKeyOrKeys?: string | string[]): GroqClient | null;
export { GroqClient };
//# sourceMappingURL=groq-client.d.ts.map
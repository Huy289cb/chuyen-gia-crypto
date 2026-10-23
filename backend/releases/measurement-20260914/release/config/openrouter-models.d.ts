/** OpenRouter dispatch fallback configuration (no service imports). */
/** Paid Scout on OpenRouter (not the :free variant). */
export declare const OPENROUTER_MODEL_SCOUT_DEFAULT = "meta-llama/llama-4-scout";
export type LlmProvider = 'groq' | 'openrouter';
/** Default groq for develop; mainnet VPS sets LLM_PROVIDER=openrouter. */
export declare function getLlmProvider(): LlmProvider;
export declare function isOpenRouterPrimaryProvider(): boolean;
export declare function isOpenRouterDispatchFallbackEnabled(): boolean;
export declare function getOpenRouterDispatchModel(): string;
export declare function getOpenRouterLevelsAdapterModel(): string;
export declare function getLevelsAdapterProvider(): 'groq' | 'openrouter';
export declare function isOpenRouterLevelsAdapterProvider(): boolean;
export declare function getOpenRouterAppHeaders(): Record<string, string>;
//# sourceMappingURL=openrouter-models.d.ts.map
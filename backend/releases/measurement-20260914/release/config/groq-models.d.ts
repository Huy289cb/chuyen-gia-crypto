/**
 * Groq model IDs — centralized.
 * @see https://console.groq.com/docs/models
 * @see https://console.groq.com/docs/deprecations
 */
/** Historical export kept for scripts/import compatibility; retired on 2026-07-17. */
export declare const GROQ_MODEL_SCOUT = "meta-llama/llama-4-scout-17b-16e-instruct";
/** Production JSON model recommended by Groq after the Llama/Qwen retirements. */
export declare const GROQ_MODEL_PRIMARY_DEFAULT = "openai/gpt-oss-120b";
/** Cheap production model for short auxiliary JSON calls. */
export declare const GROQ_MODEL_AUXILIARY_DEFAULT = "openai/gpt-oss-20b";
/** Kept as a non-retired comparison candidate for existing benchmark callers. */
export declare const GROQ_MODEL_POST_SCOUT_PRIMARY = "openai/gpt-oss-120b";
/** Production fallback only; preview models are not part of the default live chain. */
export declare const GROQ_MODEL_FALLBACKS_DEFAULT: readonly ["openai/gpt-oss-20b"];
/** IDs that now return model_not_found for free/developer accounts. */
export declare const GROQ_RETIRED_MODEL_IDS: Set<string>;
/** Default for short SL/TP repair JSON (gpt-oss works on small prompts). */
export declare const GROQ_MODEL_LEVELS_ADAPTER_DEFAULT = "openai/gpt-oss-120b";
/** Models to compare in scripts/benchmark-groq-dispatch-models.ts */
export declare const GROQ_DISPATCH_BENCHMARK_MODELS: readonly ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.6-27b"];
export declare function getGroqPrimaryModel(): string;
export declare function parseGroqFallbackModels(): string[];
/** Groq fallbacks only (excludes primary Scout). */
export declare function getGroqDispatchFallbackModels(): string[];
/** Primary first, then fallbacks (deduped). */
export declare function getGroqModelChain(): string[];
export declare function getGroqLevelsAdapterModel(): string;
export declare function getGroqTelegramAiModel(): string;
/** Short chain for auxiliary JSON calls (flip eval, etc.). */
export declare function getGroqAuxiliaryModelChain(limit?: number): string[];
//# sourceMappingURL=groq-models.d.ts.map
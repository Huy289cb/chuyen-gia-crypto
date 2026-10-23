"use strict";
/**
 * Groq model IDs — centralized.
 * @see https://console.groq.com/docs/models
 * @see https://console.groq.com/docs/deprecations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GROQ_DISPATCH_BENCHMARK_MODELS = exports.GROQ_MODEL_LEVELS_ADAPTER_DEFAULT = exports.GROQ_RETIRED_MODEL_IDS = exports.GROQ_MODEL_FALLBACKS_DEFAULT = exports.GROQ_MODEL_POST_SCOUT_PRIMARY = exports.GROQ_MODEL_AUXILIARY_DEFAULT = exports.GROQ_MODEL_PRIMARY_DEFAULT = exports.GROQ_MODEL_SCOUT = void 0;
exports.getGroqPrimaryModel = getGroqPrimaryModel;
exports.parseGroqFallbackModels = parseGroqFallbackModels;
exports.getGroqDispatchFallbackModels = getGroqDispatchFallbackModels;
exports.getGroqModelChain = getGroqModelChain;
exports.getGroqLevelsAdapterModel = getGroqLevelsAdapterModel;
exports.getGroqTelegramAiModel = getGroqTelegramAiModel;
exports.getGroqAuxiliaryModelChain = getGroqAuxiliaryModelChain;
/** Historical export kept for scripts/import compatibility; retired on 2026-07-17. */
exports.GROQ_MODEL_SCOUT = 'meta-llama/llama-4-scout-17b-16e-instruct';
/** Production JSON model recommended by Groq after the Llama/Qwen retirements. */
exports.GROQ_MODEL_PRIMARY_DEFAULT = 'openai/gpt-oss-120b';
/** Cheap production model for short auxiliary JSON calls. */
exports.GROQ_MODEL_AUXILIARY_DEFAULT = 'openai/gpt-oss-20b';
/** Kept as a non-retired comparison candidate for existing benchmark callers. */
exports.GROQ_MODEL_POST_SCOUT_PRIMARY = exports.GROQ_MODEL_PRIMARY_DEFAULT;
/** Production fallback only; preview models are not part of the default live chain. */
exports.GROQ_MODEL_FALLBACKS_DEFAULT = [exports.GROQ_MODEL_AUXILIARY_DEFAULT];
/** IDs that now return model_not_found for free/developer accounts. */
exports.GROQ_RETIRED_MODEL_IDS = new Set([
    exports.GROQ_MODEL_SCOUT,
    'meta-llama/llama-4-scout',
    'qwen/qwen3-32b',
    'llama-3.1-8b-instant',
    'llama-3.3-70b-versatile',
]);
/** Default for short SL/TP repair JSON (gpt-oss works on small prompts). */
exports.GROQ_MODEL_LEVELS_ADAPTER_DEFAULT = 'openai/gpt-oss-120b';
/** Models to compare in scripts/benchmark-groq-dispatch-models.ts */
exports.GROQ_DISPATCH_BENCHMARK_MODELS = [
    exports.GROQ_MODEL_PRIMARY_DEFAULT,
    exports.GROQ_MODEL_AUXILIARY_DEFAULT,
    'qwen/qwen3.6-27b',
];
function isUsableGroqModel(model) {
    const normalized = model?.trim();
    return Boolean(normalized) && !exports.GROQ_RETIRED_MODEL_IDS.has(normalized);
}
function dedupe(models) {
    return [...new Set(models)];
}
function getGroqPrimaryModel() {
    const configured = process.env.GROQ_MODEL_PRIMARY?.trim() ||
        process.env.GROQ_MODEL?.trim();
    return isUsableGroqModel(configured) ? configured : exports.GROQ_MODEL_PRIMARY_DEFAULT;
}
function parseGroqFallbackModels() {
    const raw = process.env.GROQ_MODEL_FALLBACKS?.trim();
    if (!raw) {
        return [...exports.GROQ_MODEL_FALLBACKS_DEFAULT];
    }
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter(isUsableGroqModel);
}
/** Groq fallbacks only (excludes primary Scout). */
function getGroqDispatchFallbackModels() {
    const primary = getGroqPrimaryModel();
    const configured = parseGroqFallbackModels().filter((m) => m !== primary);
    return configured.length > 0
        ? configured
        : exports.GROQ_MODEL_FALLBACKS_DEFAULT.filter((m) => m !== primary);
}
/** Primary first, then fallbacks (deduped). */
function getGroqModelChain() {
    const primary = getGroqPrimaryModel();
    return dedupe([primary, ...getGroqDispatchFallbackModels()]);
}
function getGroqLevelsAdapterModel() {
    const configured = process.env.GROQ_MODEL_LEVELS_ADAPTER?.trim();
    return isUsableGroqModel(configured) ? configured : exports.GROQ_MODEL_LEVELS_ADAPTER_DEFAULT;
}
function getGroqTelegramAiModel() {
    const configured = process.env.TELEGRAM_AI_MODEL?.trim();
    return isUsableGroqModel(configured) ? configured : getGroqPrimaryModel();
}
/** Short chain for auxiliary JSON calls (flip eval, etc.). */
function getGroqAuxiliaryModelChain(limit = 2) {
    const configured = process.env.GROQ_MODEL_AUXILIARY?.trim();
    const auxiliary = isUsableGroqModel(configured)
        ? configured
        : exports.GROQ_MODEL_AUXILIARY_DEFAULT;
    return dedupe([
        auxiliary,
        exports.GROQ_MODEL_PRIMARY_DEFAULT,
        ...getGroqModelChain(),
    ]).slice(0, Math.max(1, limit));
}
//# sourceMappingURL=groq-models.js.map
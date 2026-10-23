"use strict";
/** OpenRouter dispatch fallback configuration (no service imports). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPENROUTER_MODEL_SCOUT_DEFAULT = void 0;
exports.getLlmProvider = getLlmProvider;
exports.isOpenRouterPrimaryProvider = isOpenRouterPrimaryProvider;
exports.isOpenRouterDispatchFallbackEnabled = isOpenRouterDispatchFallbackEnabled;
exports.getOpenRouterDispatchModel = getOpenRouterDispatchModel;
exports.getOpenRouterLevelsAdapterModel = getOpenRouterLevelsAdapterModel;
exports.getLevelsAdapterProvider = getLevelsAdapterProvider;
exports.isOpenRouterLevelsAdapterProvider = isOpenRouterLevelsAdapterProvider;
exports.getOpenRouterAppHeaders = getOpenRouterAppHeaders;
/** Paid Scout on OpenRouter (not the :free variant). */
exports.OPENROUTER_MODEL_SCOUT_DEFAULT = 'meta-llama/llama-4-scout';
/** Default groq for develop; mainnet VPS sets LLM_PROVIDER=openrouter. */
function getLlmProvider() {
    const provider = process.env.LLM_PROVIDER?.trim().toLowerCase();
    if (provider === 'openrouter')
        return 'openrouter';
    return 'groq';
}
function isOpenRouterPrimaryProvider() {
    return getLlmProvider() === 'openrouter' && isOpenRouterDispatchFallbackEnabled();
}
function isOpenRouterDispatchFallbackEnabled() {
    if (process.env.OPENROUTER_DISPATCH_FALLBACK_ENABLED === 'false')
        return false;
    return !!process.env.OPENROUTER_API_KEY?.trim();
}
function getOpenRouterDispatchModel() {
    return process.env.OPENROUTER_DISPATCH_MODEL?.trim() || exports.OPENROUTER_MODEL_SCOUT_DEFAULT;
}
function getOpenRouterLevelsAdapterModel() {
    return (process.env.OPENROUTER_LEVELS_ADAPTER_MODEL?.trim() ||
        process.env.OPENROUTER_DISPATCH_MODEL?.trim() ||
        exports.OPENROUTER_MODEL_SCOUT_DEFAULT);
}
function getLevelsAdapterProvider() {
    const explicit = process.env.LEVELS_ADAPTER_PROVIDER?.trim().toLowerCase();
    if (explicit === 'openrouter' || explicit === 'groq')
        return explicit;
    if (getLlmProvider() === 'openrouter')
        return 'openrouter';
    return 'groq';
}
function isOpenRouterLevelsAdapterProvider() {
    return getLevelsAdapterProvider() === 'openrouter';
}
function getOpenRouterAppHeaders() {
    const referer = process.env.OPENROUTER_HTTP_REFERER?.trim() || 'https://download-money-moi.vercel.app';
    const title = process.env.OPENROUTER_APP_TITLE?.trim() || 'chuyen-gia-crypto';
    return {
        'HTTP-Referer': referer,
        'X-Title': title,
    };
}
//# sourceMappingURL=openrouter-models.js.map
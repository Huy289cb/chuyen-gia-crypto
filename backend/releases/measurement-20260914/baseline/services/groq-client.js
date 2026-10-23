"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroqClient = exports.escapeControlCharsInJsonStrings = void 0;
exports.cleanJSONResponse = cleanJSONResponse;
exports.validateAIResponse = validateAIResponse;
exports.createGroqClient = createGroqClient;
const llm_telemetry_service_1 = require("./llm-telemetry.service");
/**
 * Groq API Client Wrapper (TypeScript)
 * Handles API calls with retry logic and error handling
 */
const groq_models_1 = require("../config/groq-models");
const cerebras_models_1 = require("../config/cerebras-models");
const openrouter_models_1 = require("../config/openrouter-models");
const llm_json_1 = require("../utils/llm-json");
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Get available API keys from environment
function getApiKeys() {
    const keys = [];
    if (process.env.GROQ_API_KEY_1)
        keys.push(process.env.GROQ_API_KEY_1);
    if (process.env.GROQ_API_KEY_2)
        keys.push(process.env.GROQ_API_KEY_2);
    if (process.env.GROQ_API_KEY)
        keys.push(process.env.GROQ_API_KEY);
    return keys.length > 0 ? keys : null;
}
function isRateLimitErrorMessage(message = '') {
    const normalized = message.toLowerCase();
    return normalized.includes('429') || normalized.includes('rate limit');
}
function isDailyTokenLimitError(message = '') {
    const normalized = message.toLowerCase();
    return normalized.includes('tokens per day') || normalized.includes('tpd');
}
// Rate limiting protection
let lastCallTime = 0;
const MIN_CALL_INTERVAL = 2000; // 2 seconds minimum between calls
/** Re-export for existing unit tests / callers. */
exports.escapeControlCharsInJsonStrings = llm_json_1.escapeControlCharsInJsonStrings;
/** Clean + repair LLM JSON (OpenRouter-heavy failure modes). Truncated → null. */
function cleanJSONResponse(rawResponse) {
    const parsed = (0, llm_json_1.parseLlmJsonObject)(rawResponse);
    if (!parsed) {
        console.error('Lỗi parse JSON thủ công: unrecoverable or truncated');
        console.log('[GroqClient] Raw response length:', rawResponse.length);
        console.log('[GroqClient] Raw response preview:', rawResponse.substring(0, 500));
        return null;
    }
    console.log('[GroqClient] Cleaned JSON keys:', Object.keys(parsed).join(','));
    return parsed;
}
// Validate AI response for consistency and correctness
function validateAIResponse(response, symbol) {
    if (!response || !symbol)
        return true;
    const analysis = response[symbol.toLowerCase()];
    if (!analysis)
        return true;
    // Check bias-action consistency
    if (analysis.bias === 'bullish' && analysis.action !== 'buy') {
        throw new Error('Invalid AI response: bullish requires buy action');
    }
    if (analysis.bias === 'bearish' && analysis.action !== 'sell') {
        throw new Error('Invalid AI response: bearish requires sell action');
    }
    if (analysis.bias === 'neutral' && analysis.action !== 'hold') {
        throw new Error('Invalid AI response: neutral requires hold action');
    }
    // Check SL/TP placement
    if (analysis.bias === 'bullish') {
        if (analysis.suggested_stop_loss >= analysis.suggested_entry) {
            throw new Error('Invalid AI response: LONG SL must be below entry');
        }
        if (analysis.suggested_take_profit <= analysis.suggested_entry) {
            throw new Error('Invalid AI response: LONG TP must be above entry');
        }
    }
    else if (analysis.bias === 'bearish') {
        if (analysis.suggested_stop_loss <= analysis.suggested_entry) {
            throw new Error('Invalid AI response: SHORT SL must be above entry');
        }
        if (analysis.suggested_take_profit >= analysis.suggested_entry) {
            throw new Error('Invalid AI response: SHORT TP must be below entry');
        }
    }
    return true;
}
// Fetch with timeout to prevent hanging in production
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await (0, llm_telemetry_service_1.fetchWithLlmTelemetry)(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    }
    catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error(`Request timeout after ${timeoutMs}ms`);
        }
        throw error;
    }
}
class GroqClient {
    apiKeys;
    currentKeyIndex;
    baseUrl;
    constructor(apiKeys) {
        this.apiKeys = Array.isArray(apiKeys) ? apiKeys : [apiKeys];
        this.currentKeyIndex = 0;
        this.baseUrl = GROQ_API_URL;
    }
    getCurrentApiKey() {
        return this.apiKeys[this.currentKeyIndex] || this.apiKeys[0];
    }
    switchToNextApiKey() {
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
        console.log(`[GroqClient] Switching to API key ${this.currentKeyIndex + 1}/${this.apiKeys.length}`);
    }
    resetToFirstApiKey() {
        this.currentKeyIndex = 0;
        console.log(`[GroqClient] Resetting to first API key`);
    }
    /**
     * Try a subset of Groq models across all API keys. Returns null when every key/model fails.
     */
    async tryGroqModels(modelsToTry, params) {
        if (modelsToTry.length === 0)
            return null;
        const { systemPrompt, userPrompt, temperature, maxRetries } = params;
        let lastError;
        const totalApiKeys = this.apiKeys.length;
        const keysTried = new Set();
        this.resetToFirstApiKey();
        while (keysTried.size < totalApiKeys) {
            const currentKeyIndex = this.currentKeyIndex;
            keysTried.add(currentKeyIndex);
            console.log(`[GroqClient] Using API key ${currentKeyIndex + 1}/${totalApiKeys} (tried ${keysTried.size}/${totalApiKeys} keys)`);
            for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex++) {
                const currentModel = modelsToTry[modelIndex];
                console.log(`[GroqClient] Trying model: ${currentModel}`);
                const isGptOss = currentModel.startsWith('openai/gpt-oss-');
                const requestBody = {
                    model: currentModel,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt },
                    ],
                    temperature,
                    max_completion_tokens: 4096,
                    response_format: { type: 'json_object' },
                    ...(isGptOss
                        ? { reasoning_effort: 'low', include_reasoning: false }
                        : {}),
                };
                for (let attempt = 0; attempt <= maxRetries; attempt++) {
                    try {
                        console.log(`[GroqClient] Model ${currentModel} - Attempt ${attempt + 1}/${maxRetries + 1}`);
                        const response = await fetchWithTimeout(this.baseUrl, {
                            method: 'POST',
                            headers: {
                                Authorization: `Bearer ${this.getCurrentApiKey()}`,
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(requestBody),
                        }, 30000);
                        if (!response.ok) {
                            const errorText = await response.text();
                            throw new Error(`Groq API error: ${response.status} - ${errorText}`);
                        }
                        const data = (await response.json());
                        const content = data.choices?.[0]?.message?.content;
                        if (!content) {
                            throw new Error('Empty response from Groq API');
                        }
                        const parsed = cleanJSONResponse(content);
                        if (parsed === null) {
                            console.error('[GroqClient] Failed to clean JSON from response');
                            console.log('[GroqClient] Raw content:', content.substring(0, 200));
                            throw new Error('Invalid JSON in response after cleaning');
                        }
                        console.log(`[GroqClient] Successfully parsed response from model ${currentModel} with API key ${currentKeyIndex + 1}`);
                        return parsed;
                    }
                    catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        lastError = error instanceof Error ? error : new Error(message);
                        console.error(`[GroqClient] Model ${currentModel} - Attempt ${attempt + 1} failed:`, message);
                        if (isDailyTokenLimitError(message)) {
                            console.warn(`[GroqClient] Daily token limit hit for model ${currentModel}, skipping remaining retries for this model`);
                            break;
                        }
                        if (attempt < maxRetries) {
                            const delay = isRateLimitErrorMessage(message)
                                ? 60000
                                : Math.pow(2, attempt) * 1000;
                            console.log(`[GroqClient] Retrying in ${delay}ms...`);
                            await new Promise((resolve) => setTimeout(resolve, delay));
                        }
                    }
                }
            }
            console.log(`[GroqClient] All ${modelsToTry.length} model(s) failed with API key ${currentKeyIndex + 1}/${totalApiKeys}, switching to next key...`);
            this.switchToNextApiKey();
        }
        this.resetToFirstApiKey();
        if (lastError) {
            console.error(`[GroqClient] Groq model batch failed: ${lastError.message}`);
        }
        return null;
    }
    async tryOpenRouterDispatch(params, stepLabel) {
        if (!(0, openrouter_models_1.isOpenRouterDispatchFallbackEnabled)())
            return null;
        try {
            console.log(`[GroqClient] ${stepLabel}: OpenRouter Scout`);
            const { analyzeViaOpenRouter } = await Promise.resolve().then(() => __importStar(require('./openrouter-client')));
            return await analyzeViaOpenRouter(params);
        }
        catch (openRouterErr) {
            const msg = openRouterErr instanceof Error ? openRouterErr.message : String(openRouterErr);
            console.error(`[GroqClient] OpenRouter dispatch failed: ${msg}`);
            return null;
        }
    }
    async tryCerebrasDispatch(params, stepLabel) {
        if (!(0, cerebras_models_1.isCerebrasDispatchFallbackEnabled)())
            return null;
        try {
            console.log(`[GroqClient] ${stepLabel}: Cerebras gpt-oss fallback`);
            const { analyzeViaCerebras } = await Promise.resolve().then(() => __importStar(require('./cerebras-client')));
            return await analyzeViaCerebras(params);
        }
        catch (cerebrasErr) {
            const msg = cerebrasErr instanceof Error ? cerebrasErr.message : String(cerebrasErr);
            console.error(`[GroqClient] Cerebras dispatch fallback failed: ${msg}`);
            return null;
        }
    }
    /**
     * Dispatch order:
     * - LLM_PROVIDER=openrouter (mainnet): OpenRouter Scout → Groq production
     *   models → Cerebras (optional last resort).
     * - default groq: Groq → Cerebras → OpenRouter → Groq fallbacks
     */
    async analyzeDispatchChain(params) {
        const { systemPrompt, userPrompt, temperature = 0.2, maxRetries = 5 } = params;
        const groqParams = { systemPrompt, userPrompt, temperature, maxRetries };
        const llmParams = { systemPrompt, userPrompt, temperature };
        if ((0, openrouter_models_1.isOpenRouterPrimaryProvider)()) {
            const openRouterPrimary = await this.tryOpenRouterDispatch(llmParams, 'Dispatch step 1');
            if (openRouterPrimary)
                return openRouterPrimary;
            const groqFallback = await this.tryGroqModels((0, groq_models_1.getGroqModelChain)(), groqParams);
            if (groqFallback)
                return groqFallback;
            const cerebrasResult = await this.tryCerebrasDispatch(llmParams, 'Dispatch step 3');
            if (cerebrasResult)
                return cerebrasResult;
            throw new Error('OpenRouter primary and Groq fallback both failed');
        }
        const primary = (0, groq_models_1.getGroqPrimaryModel)();
        console.log(`[GroqClient] Dispatch step 1: Groq primary ${primary}`);
        const primaryResult = await this.tryGroqModels([primary], groqParams);
        if (primaryResult)
            return primaryResult;
        const cerebrasResult = await this.tryCerebrasDispatch(llmParams, 'Dispatch step 2');
        if (cerebrasResult)
            return cerebrasResult;
        const openRouterFallback = await this.tryOpenRouterDispatch(llmParams, 'Dispatch step 3');
        if (openRouterFallback)
            return openRouterFallback;
        const groqFallbacks = (0, groq_models_1.getGroqDispatchFallbackModels)();
        if (groqFallbacks.length > 0) {
            console.log(`[GroqClient] Dispatch step 4+: Groq fallbacks (${groqFallbacks.join(', ')})`);
            const fallbackResult = await this.tryGroqModels(groqFallbacks, groqParams);
            if (fallbackResult)
                return fallbackResult;
        }
        throw new Error('All dispatch providers failed');
    }
    /**
     * Send chat completion request to Groq API
     */
    async analyze(params) {
        const { systemPrompt, userPrompt, temperature = 0.2, maxRetries = 5, preferredModels } = params;
        // Rate limiting protection
        const now = Date.now();
        const timeSinceLastCall = now - lastCallTime;
        if (timeSinceLastCall < MIN_CALL_INTERVAL) {
            const waitTime = MIN_CALL_INTERVAL - timeSinceLastCall;
            console.log(`[GroqClient] Rate limiting: waiting ${waitTime}ms before API call`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        lastCallTime = Date.now();
        if (!preferredModels || preferredModels.length === 0) {
            return this.analyzeDispatchChain(params);
        }
        const result = await this.tryGroqModels(preferredModels, {
            systemPrompt,
            userPrompt,
            temperature,
            maxRetries,
        });
        if (result)
            return result;
        throw new Error(`All models failed with all API keys for preferredModels`);
    }
    /**
     * Plain-text completion for ops Q&A (Telegram AI). No JSON parsing.
     */
    async completeText(params) {
        const { systemPrompt, userPrompt, temperature = 0.3, maxTokens = 2048, maxRetries = 3, preferredModels, } = params;
        const now = Date.now();
        const timeSinceLastCall = now - lastCallTime;
        if (timeSinceLastCall < MIN_CALL_INTERVAL) {
            const waitTime = MIN_CALL_INTERVAL - timeSinceLastCall;
            console.log(`[GroqOps] Rate limiting: waiting ${waitTime}ms before API call`);
            await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
        lastCallTime = Date.now();
        let lastError;
        const totalApiKeys = this.apiKeys.length;
        const keysTried = new Set();
        while (keysTried.size < totalApiKeys) {
            const currentKeyIndex = this.currentKeyIndex;
            keysTried.add(currentKeyIndex);
            console.log(`[GroqOps] Using API key ${currentKeyIndex + 1}/${totalApiKeys} (tried ${keysTried.size}/${totalApiKeys} keys)`);
            const modelsToTry = preferredModels && preferredModels.length > 0 ? preferredModels : (0, groq_models_1.getGroqModelChain)();
            for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex++) {
                const currentModel = modelsToTry[modelIndex];
                console.log(`[GroqOps] Trying model: ${currentModel}`);
                const isGptOss = currentModel.startsWith('openai/gpt-oss-');
                const requestBody = {
                    model: currentModel,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt },
                    ],
                    temperature,
                    max_completion_tokens: maxTokens,
                    ...(isGptOss
                        ? { reasoning_effort: 'low', include_reasoning: false }
                        : {}),
                };
                for (let attempt = 0; attempt <= maxRetries; attempt++) {
                    try {
                        console.log(`[GroqOps] Model ${currentModel} - Attempt ${attempt + 1}/${maxRetries + 1}`);
                        const response = await fetchWithTimeout(this.baseUrl, {
                            method: 'POST',
                            headers: {
                                Authorization: `Bearer ${this.getCurrentApiKey()}`,
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(requestBody),
                        }, 30000);
                        if (!response.ok) {
                            const errorText = await response.text();
                            throw new Error(`Groq API error: ${response.status} - ${errorText}`);
                        }
                        const data = (await response.json());
                        const content = data.choices?.[0]?.message?.content;
                        if (!content || !content.trim()) {
                            throw new Error('Empty response from Groq API');
                        }
                        console.log(`[GroqOps] Text completion OK model=${currentModel} len=${content.length}`);
                        return content.trim();
                    }
                    catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        lastError = error instanceof Error ? error : new Error(message);
                        console.error(`[GroqOps] Model ${currentModel} - Attempt ${attempt + 1} failed:`, message);
                        if (isDailyTokenLimitError(message))
                            break;
                        if (attempt < maxRetries) {
                            const delay = isRateLimitErrorMessage(message)
                                ? 60000
                                : Math.pow(2, attempt) * 1000;
                            await new Promise((resolve) => setTimeout(resolve, delay));
                        }
                    }
                }
            }
            console.log(`[GroqOps] All models failed with API key ${currentKeyIndex + 1}/${totalApiKeys}, switching...`);
            this.switchToNextApiKey();
        }
        this.resetToFirstApiKey();
        throw new Error(`Groq text completion failed: ${lastError?.message}`);
    }
    /**
     * Check if API key is valid by making a test request
     */
    async validateKey() {
        try {
            const response = await fetchWithTimeout('https://api.groq.com/openai/v1/models', {
                headers: {
                    'Authorization': `Bearer ${this.apiKeys[0]}`
                }
            }, 10000); // 10s timeout for validation
            return response.ok;
        }
        catch {
            return false;
        }
    }
}
exports.GroqClient = GroqClient;
// Factory function for easy instantiation
function createGroqClient(apiKeyOrKeys) {
    const keys = apiKeyOrKeys === undefined || apiKeyOrKeys === null
        ? getApiKeys()
        : Array.isArray(apiKeyOrKeys)
            ? apiKeyOrKeys
            : [apiKeyOrKeys];
    if (!keys || keys.length === 0) {
        console.log('[GroqClient] No API key provided, client will use fallback');
        return null;
    }
    console.log(`[GroqClient] Initialized with ${keys.length} API key(s)`);
    return new GroqClient(keys);
}
//# sourceMappingURL=groq-client.js.map
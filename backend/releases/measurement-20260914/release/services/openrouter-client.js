"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractOpenRouterMessageContent = extractOpenRouterMessageContent;
exports.analyzeViaOpenRouter = analyzeViaOpenRouter;
const llm_telemetry_service_1 = require("./llm-telemetry.service");
/**
 * OpenRouter primary dispatch (OpenAI-compatible).
 * Paid Scout + response_format json_object, with parse retry.
 */
const openrouter_models_1 = require("../config/openrouter-models");
const groq_client_1 = require("./groq-client");
const OPENROUTER_CHAT_URL = process.env.OPENROUTER_API_BASE_URL?.trim() ||
    'https://openrouter.ai/api/v1/chat/completions';
const JSON_ONLY_NUDGE = '\n\nIMPORTANT: Reply with ONLY one valid minified JSON object. No markdown fences, no commentary.';
function openRouterMaxTokens() {
    const n = Number(process.env.OPENROUTER_MAX_TOKENS);
    return Number.isFinite(n) && n >= 512 ? Math.floor(n) : 4096;
}
function openRouterParseRetries(override) {
    if (override != null && override >= 1)
        return Math.floor(override);
    const n = Number(process.env.OPENROUTER_JSON_RETRIES);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
}
/** Normalize OpenRouter message.content (string | multipart array). */
function extractOpenRouterMessageContent(data) {
    if (!data || typeof data !== 'object')
        return '';
    const choices = data.choices;
    if (!Array.isArray(choices) || choices.length === 0)
        return '';
    const message = choices[0]?.message;
    if (!message || typeof message !== 'object')
        return '';
    const content = message.content;
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
            if (typeof part === 'string')
                return part;
            if (part && typeof part === 'object' && typeof part.text === 'string') {
                return part.text;
            }
            return '';
        })
            .join('');
    }
    return '';
}
async function callOpenRouterOnce(params) {
    const response = await (0, llm_telemetry_service_1.fetchWithLlmTelemetry)(OPENROUTER_CHAT_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${params.key}`,
            'Content-Type': 'application/json',
            ...(0, openrouter_models_1.getOpenRouterAppHeaders)(),
        },
        body: JSON.stringify({
            model: params.model,
            messages: [
                { role: 'system', content: params.systemPrompt },
                { role: 'user', content: params.userPrompt },
            ],
            temperature: params.temperature,
            max_tokens: openRouterMaxTokens(),
            response_format: { type: 'json_object' },
        }),
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status} - ${text.slice(0, 220)}`);
    }
    let data;
    try {
        data = JSON.parse(text);
    }
    catch {
        throw new Error(`OpenRouter envelope JSON parse failed: ${text.slice(0, 120)}`);
    }
    const content = extractOpenRouterMessageContent(data);
    if (!content.trim()) {
        throw new Error('Empty response from OpenRouter API');
    }
    return content;
}
async function analyzeViaOpenRouter(params) {
    const key = process.env.OPENROUTER_API_KEY?.trim();
    if (!key) {
        throw new Error('OPENROUTER_API_KEY not configured');
    }
    const model = params.model?.trim() || (0, openrouter_models_1.getOpenRouterDispatchModel)();
    const logLabel = params.logLabel?.trim() || 'Dispatch';
    const maxAttempts = openRouterParseRetries(params.maxParseRetries);
    let systemPrompt = params.systemPrompt;
    let userPrompt = params.userPrompt;
    let temperature = params.temperature ?? 0.15;
    let lastParsePreview = '';
    console.log(`[OpenRouterClient] ${logLabel} model=${model} (json_object, max_tokens=${openRouterMaxTokens()}, retries=${maxAttempts})`);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const content = await callOpenRouterOnce({
            key,
            model,
            systemPrompt,
            userPrompt,
            temperature,
        });
        const parsed = (0, groq_client_1.cleanJSONResponse)(content);
        if (parsed !== null) {
            if (attempt > 1) {
                console.log(`[OpenRouterClient] Parsed OK on attempt ${attempt}/${maxAttempts}`);
            }
            else {
                console.log(`[OpenRouterClient] Successfully parsed dispatch JSON from ${model}`);
            }
            return parsed;
        }
        lastParsePreview = content.slice(0, 180).replace(/\s+/g, ' ');
        console.warn(`[OpenRouterClient] Bad JSON attempt ${attempt}/${maxAttempts}: ${lastParsePreview}`);
        // Stricter retry: lower temp + explicit JSON-only nudge
        temperature = 0;
        if (!userPrompt.includes('ONLY one valid')) {
            userPrompt = `${userPrompt}${JSON_ONLY_NUDGE}`;
        }
        if (!systemPrompt.includes('valid JSON object')) {
            systemPrompt = `${systemPrompt}\nYou must respond with a single valid JSON object only.`;
        }
    }
    throw new Error(`Invalid JSON in OpenRouter response after ${maxAttempts} attempts: ${lastParsePreview}`);
}
//# sourceMappingURL=openrouter-client.js.map
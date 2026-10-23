"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeViaCerebras = analyzeViaCerebras;
const llm_telemetry_service_1 = require("./llm-telemetry.service");
/**
 * Cerebras Cloud dispatch fallback (OpenAI-compatible).
 * Uses gpt-oss-120b with response_format json_object — required for reliable trade JSON.
 */
const cerebras_models_1 = require("../config/cerebras-models");
const groq_client_1 = require("./groq-client");
const CEREBRAS_CHAT_URL = process.env.CEREBRAS_API_BASE_URL?.trim() ||
    'https://api.cerebras.ai/v1/chat/completions';
async function analyzeViaCerebras(params) {
    const key = process.env.CEREBRAS_API_KEY?.trim();
    if (!key) {
        throw new Error('CEREBRAS_API_KEY not configured');
    }
    const model = (0, cerebras_models_1.getCerebrasDispatchModel)();
    const { systemPrompt, userPrompt, temperature = 0.15 } = params;
    console.log(`[CerebrasClient] Dispatch fallback model=${model} (json_object)`);
    const response = await (0, llm_telemetry_service_1.fetchWithLlmTelemetry)(CEREBRAS_CHAT_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            temperature,
            max_tokens: 2048,
            response_format: { type: 'json_object' },
        }),
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`Cerebras API error: ${response.status} - ${text.slice(0, 220)}`);
    }
    const data = JSON.parse(text);
    const content = data.choices?.[0]?.message?.content ?? '';
    if (!content.trim()) {
        throw new Error('Empty response from Cerebras API');
    }
    const parsed = (0, groq_client_1.cleanJSONResponse)(content);
    if (parsed === null) {
        throw new Error('Invalid JSON in Cerebras response after cleaning');
    }
    console.log(`[CerebrasClient] Successfully parsed dispatch JSON from ${model}`);
    return parsed;
}
//# sourceMappingURL=cerebras-client.js.map
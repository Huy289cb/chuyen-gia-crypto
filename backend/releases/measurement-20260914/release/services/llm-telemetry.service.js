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
exports.fetchWithLlmTelemetry = fetchWithLlmTelemetry;
const entry_trace_1 = require("../utils/entry-trace");
/** Persist only provider/model/status, never headers, prompts, responses or keys. */
async function fetchWithLlmTelemetry(url, options = {}) {
    if (process.env.NODE_ENV === 'test')
        return fetch(url, options);
    let model = 'unknown';
    try {
        model = String(JSON.parse(String(options.body ?? '{}')).model ?? 'unknown');
    }
    catch { /* metadata only */ }
    const provider = new URL(url).hostname;
    const requestId = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`;
    const started = Date.now();
    const record = async (type, data) => {
        try {
            const { recordSilentPipelineEvent } = await Promise.resolve().then(() => __importStar(require('../repositories/testnet.repository')));
            await recordSilentPipelineEvent(type, (0, entry_trace_1.tracedEvent)({ request_id: requestId, provider, model, cost_usd: null, cost_status: 'unknown', ...data }));
        }
        catch {
            console.warn('[LlmTelemetry] Could not persist provider request metadata');
        }
    };
    await record('llm_provider_request', {});
    try {
        const response = await fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(45_000) });
        let costUsd = null;
        let inputTokens = null, outputTokens = null;
        try {
            const request = JSON.parse(String(options.body ?? '{}'));
            if (response.ok && request.stream !== true) {
                const result = await response.clone().json();
                const number = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
                costUsd = number(result.usage?.cost);
                inputTokens = number(result.usage?.prompt_tokens);
                outputTokens = number(result.usage?.completion_tokens);
            }
        }
        catch { /* Missing usage is unknown, never zero. Original response remains readable. */ }
        await record('llm_provider_result', { status: response.status, ok: response.ok, latency_ms: Date.now() - started,
            cost_usd: costUsd, cost_status: costUsd === null ? 'unknown' : 'reported', input_tokens: inputTokens, output_tokens: outputTokens });
        return response;
    }
    catch (error) {
        await record('llm_provider_result', { ok: false, status: null, latency_ms: Date.now() - started });
        throw error;
    }
}

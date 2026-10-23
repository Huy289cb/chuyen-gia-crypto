import { fetchWithLlmTelemetry } from './llm-telemetry.service';
/**
 * OpenRouter primary dispatch (OpenAI-compatible).
 * OpenRouter dispatch with JSON response enforcement and parse retry.
 */

import {
  getOpenRouterAppHeaders,
  getOpenRouterDispatchModel,
} from '../config/openrouter-models';
import { cleanJSONResponse, type GroqAnalysis } from './groq-client';

export interface OpenRouterAnalyzeRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  /** Override dispatch model (e.g. levels adapter). */
  model?: string;
  logLabel?: string;
  /** Parse retries on bad JSON (default 3). */
  maxParseRetries?: number;
  /** Structured schema is opt-in until shadow evaluation completes. */
  responseFormat?: 'json_object' | 'json_schema';
}

const OPENROUTER_CHAT_URL =
  process.env.OPENROUTER_API_BASE_URL?.trim() ||
  'https://openrouter.ai/api/v1/chat/completions';

const JSON_ONLY_NUDGE =
  '\n\nIMPORTANT: Reply with ONLY one valid minified JSON object. No markdown fences, no commentary.';

const TRADE_ANALYSIS_SCHEMA = {
  name: 'trade_analysis',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      bias: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
      action: { type: 'string', enum: ['buy', 'sell', 'hold'] },
      confidence: { type: 'number', minimum: 0, maximum: 100 },
      suggested_entry: { type: ['number', 'null'] },
      suggested_stop_loss: { type: ['number', 'null'] },
      suggested_take_profit: { type: ['number', 'null'] },
      expected_rr: { type: ['number', 'null'] },
      invalidation_level: { type: ['number', 'null'] },
      reason_summary: { type: 'string' },
    },
    required: ['bias', 'action', 'confidence', 'suggested_entry', 'suggested_stop_loss',
      'suggested_take_profit', 'expected_rr', 'invalidation_level', 'reason_summary'],
    additionalProperties: false,
  },
} as const;

function openRouterMaxTokens(): number {
  const n = Number(process.env.OPENROUTER_MAX_TOKENS);
  return Number.isFinite(n) && n >= 512 ? Math.floor(n) : 4096;
}

function openRouterParseRetries(override?: number): number {
  if (override != null && override >= 1) return Math.floor(override);
  const n = Number(process.env.OPENROUTER_JSON_RETRIES);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
}

/** Normalize OpenRouter message.content (string | multipart array). */
export function extractOpenRouterMessageContent(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const message = (choices[0] as { message?: unknown })?.message;
  if (!message || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .join('');
  }
  return '';
}

async function callOpenRouterOnce(params: {
  key: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  responseFormat: 'json_object' | 'json_schema';
}): Promise<string> {
  const response = await fetchWithLlmTelemetry(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.key}`,
      'Content-Type': 'application/json',
      ...getOpenRouterAppHeaders(),
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
      temperature: params.temperature,
      max_tokens: openRouterMaxTokens(),
      ...(params.responseFormat === 'json_schema'
        ? { provider: { require_parameters: true } }
        : {}),
      response_format: params.responseFormat === 'json_schema'
        ? { type: 'json_schema', json_schema: TRADE_ANALYSIS_SCHEMA }
        : { type: 'json_object' },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status} - ${text.slice(0, 220)}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`OpenRouter envelope JSON parse failed: ${text.slice(0, 120)}`);
  }

  const content = extractOpenRouterMessageContent(data);
  if (!content.trim()) {
    throw new Error('Empty response from OpenRouter API');
  }
  return content;
}

export async function analyzeViaOpenRouter(
  params: OpenRouterAnalyzeRequest
): Promise<GroqAnalysis> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }

  const model = params.model?.trim() || getOpenRouterDispatchModel();
  const logLabel = params.logLabel?.trim() || 'Dispatch';
  const maxAttempts = openRouterParseRetries(params.maxParseRetries);
  const responseFormat = params.responseFormat ?? 'json_object';
  let systemPrompt = params.systemPrompt;
  let userPrompt = params.userPrompt;
  let temperature = params.temperature ?? 0.15;
  let lastParsePreview = '';

  console.log(
    `[OpenRouterClient] ${logLabel} model=${model} (${responseFormat}, max_tokens=${openRouterMaxTokens()}, retries=${maxAttempts})`
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const content = await callOpenRouterOnce({
      key,
      model,
      systemPrompt,
      userPrompt,
      temperature,
      responseFormat,
    });
    const parsed = cleanJSONResponse(content);
    if (parsed !== null) {
      if (attempt > 1) {
        console.log(`[OpenRouterClient] Parsed OK on attempt ${attempt}/${maxAttempts}`);
      } else {
        console.log(`[OpenRouterClient] Successfully parsed dispatch JSON from ${model}`);
      }
      return parsed;
    }

    lastParsePreview = content.slice(0, 180).replace(/\s+/g, ' ');
    console.warn(
      `[OpenRouterClient] Bad JSON attempt ${attempt}/${maxAttempts}: ${lastParsePreview}`
    );

    // Stricter retry: lower temp + explicit JSON-only nudge
    temperature = 0;
    if (!userPrompt.includes('ONLY one valid')) {
      userPrompt = `${userPrompt}${JSON_ONLY_NUDGE}`;
    }
    if (!systemPrompt.includes('valid JSON object')) {
      systemPrompt = `${systemPrompt}\nYou must respond with a single valid JSON object only.`;
    }
  }

  throw new Error(
    `Invalid JSON in OpenRouter response after ${maxAttempts} attempts: ${lastParsePreview}`
  );
}

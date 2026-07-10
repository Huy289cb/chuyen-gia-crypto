/**
 * OpenRouter dispatch fallback (OpenAI-compatible).
 * Uses paid Llama 4 Scout with response_format json_object.
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
}

const OPENROUTER_CHAT_URL =
  process.env.OPENROUTER_API_BASE_URL?.trim() ||
  'https://openrouter.ai/api/v1/chat/completions';

export async function analyzeViaOpenRouter(
  params: OpenRouterAnalyzeRequest
): Promise<GroqAnalysis> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }

  const model = params.model?.trim() || getOpenRouterDispatchModel();
  const { systemPrompt, userPrompt, temperature = 0.15 } = params;
  const logLabel = params.logLabel?.trim() || 'Dispatch fallback';

  console.log(`[OpenRouterClient] ${logLabel} model=${model} (json_object)`);

  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      Apehorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...getOpenRouterAppHeaders(),
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
    throw new Error(`OpenRouter API error: ${response.status} - ${text.slice(0, 220)}`);
  }

  const data = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) {
    throw new Error('Empty response from OpenRouter API');
  }

  const parsed = cleanJSONResponse(content);
  if (parsed === null) {
    throw new Error('Invalid JSON in OpenRouter response after cleaning');
  }

  console.log(`[OpenRouterClient] Successfully parsed dispatch JSON from ${model}`);
  return parsed;
}

/**
 * Cerebras Cloud dispatch fallback (OpenAI-compatible).
 * Uses gpt-oss-120b with response_format json_object — required for reliable trade JSON.
 */

import { getCerebrasDispatchModel } from '../config/cerebras-models';
import { cleanJSONResponse, type GroqAnalysis } from './groq-client';

export interface CerebrasAnalyzeRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
}

const CEREBRAS_CHAT_URL =
  process.env.CEREBRAS_API_BASE_URL?.trim() ||
  'https://api.cerebras.ai/v1/chat/completions';

export async function analyzeViaCerebras(
  params: CerebrasAnalyzeRequest
): Promise<GroqAnalysis> {
  const key = process.env.CEREBRAS_API_KEY?.trim();
  if (!key) {
    throw new Error('CEREBRAS_API_KEY not configured');
  }

  const model = getCerebrasDispatchModel();
  const { systemPrompt, userPrompt, temperature = 0.15 } = params;

  console.log(`[CerebrasClient] Dispatch fallback model=${model} (json_object)`);

  const response = await fetch(CEREBRAS_CHAT_URL, {
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

  const data = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) {
    throw new Error('Empty response from Cerebras API');
  }

  const parsed = cleanJSONResponse(content);
  if (parsed === null) {
    throw new Error('Invalid JSON in Cerebras response after cleaning');
  }

  console.log(`[CerebrasClient] Successfully parsed dispatch JSON from ${model}`);
  return parsed;
}

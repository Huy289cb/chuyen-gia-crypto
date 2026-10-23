import { withProviderPurpose } from '../utils/provider-purpose-context';
import { fetchWithLlmTelemetry } from './llm-telemetry.service';
import type { AiOpportunityPolicy } from '../config/ai-opportunity-policy';
import type { OpportunityProviderResult } from './ai-opportunity-review.service';

export async function requestOpportunityReview(system: string, user: string, policy: AiOpportunityPolicy,
  signal: AbortSignal): Promise<OpportunityProviderResult> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key || user.length > 180000) throw new Error('provider_input_unavailable');
  // Explicit endpoint; no tools, no credentials in prompts, no retries after a claimed wave.
  const response = await withProviderPurpose('opportunity_review', () => fetchWithLlmTelemetry('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', signal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: policy.model, temperature: 0, max_tokens: 600,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  }));
  if (!response.ok) throw new Error(`provider_http_${response.status}`);
  const data = await response.json() as { choices?: { message?: { content?: unknown } }[];
    model?: unknown; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown } };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length > 8192) throw new Error('provider_content_invalid');
  const number = (n: unknown): number | null => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
  return { content, model: typeof data.model === 'string' ? data.model : policy.model,
    inputTokens: number(data.usage?.prompt_tokens), outputTokens: number(data.usage?.completion_tokens),
    costUsd: number(data.usage?.cost) };
}

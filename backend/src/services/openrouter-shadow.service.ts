import {withProviderPurpose} from '../utils/provider-purpose-context';
import { createHash } from 'node:crypto';
import { getOpenRouterDispatchModel, getOpenRouterShadowModel } from '../config/openrouter-models';
import { recordSilentPipelineEvent } from '../repositories/testnet.repository';
import { analyzeViaOpenRouter } from './openrouter-client';
import type { GroqAnalysis } from './groq-client';

export interface OpenRouterShadowInput {
  systemPrompt: string;
  userPrompt: string;
  primaryAnalysis: GroqAnalysis;
  symbol: string;
  timeframe: string;
  decisionCandleOpenMs?: number;
  candidateKey?: string;
  expectedSide?: 'long' | 'short' | null;
}

function normalizedConfidence(value: unknown): number | null {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return null;
  return numeric > 1 ? numeric / 100 : numeric;
}

/**
 * Evaluate a challenger on the exact live prompt and persist observation only.
 * This function absorbs every error so the shadow lane cannot affect execution.
 */
export async function observeOpenRouterShadowDecision(input: OpenRouterShadowInput): Promise<void> {
  const model = getOpenRouterShadowModel();
  if (!model) return;

  const started = Date.now();
  const promptHash = createHash('sha256')
    .update(input.systemPrompt)
    .update('\0')
    .update(input.userPrompt)
    .digest('hex');

  try {
    const analysis = await withProviderPurpose('shadow', () => analyzeViaOpenRouter({
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      temperature: 0.2,
      model,
      logLabel: 'Shadow challenger',
      maxParseRetries: 1,
      responseFormat: 'json_object',
    }));
    const confidence = normalizedConfidence(analysis.confidence);
    const minConfidence = Number(process.env.OPENROUTER_SHADOW_MIN_CONFIDENCE || 0.80);
    await recordSilentPipelineEvent('llm_model_shadow_decision', {
      role: 'challenger',
      model,
      primary_model: getOpenRouterDispatchModel(),
      response_format: 'json_object',
      prompt_hash: promptHash,
      symbol: input.symbol,
      timeframe: input.timeframe,
      decision_candle_open_ms: input.decisionCandleOpenMs ?? null,
      candidate_key: input.candidateKey ?? null,
      expected_side: input.expectedSide ?? null,
      latency_ms: Date.now() - started,
      min_confidence: minConfidence,
      valid: confidence !== null && ['buy', 'sell', 'hold'].includes(analysis.action),
      would_confirm: confidence !== null
        && confidence >= minConfidence
        && ['buy', 'sell'].includes(analysis.action),
      action: analysis.action,
      bias: analysis.bias,
      confidence,
      suggested_entry: analysis.suggested_entry ?? null,
      suggested_stop_loss: analysis.suggested_stop_loss ?? null,
      suggested_take_profit: analysis.suggested_take_profit ?? null,
      expected_rr: analysis.expected_rr ?? null,
      reason_summary: analysis.reason_summary?.slice(0, 500) ?? null,
      primary_action: input.primaryAnalysis.action,
      primary_confidence: normalizedConfidence(input.primaryAnalysis.confidence),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await recordSilentPipelineEvent('llm_model_shadow_decision', {
      role: 'challenger',
      model,
      primary_model: getOpenRouterDispatchModel(),
      response_format: 'json_object',
      prompt_hash: promptHash,
      symbol: input.symbol,
      timeframe: input.timeframe,
      decision_candle_open_ms: input.decisionCandleOpenMs ?? null,
      candidate_key: input.candidateKey ?? null,
      expected_side: input.expectedSide ?? null,
      latency_ms: Date.now() - started,
      min_confidence: Number(process.env.OPENROUTER_SHADOW_MIN_CONFIDENCE || 0.80),
      valid: false,
      error: message.slice(0, 500),
      primary_action: input.primaryAnalysis.action,
      primary_confidence: normalizedConfidence(input.primaryAnalysis.confidence),
    });
  }
}

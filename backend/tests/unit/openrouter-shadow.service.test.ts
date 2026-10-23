import {currentProviderPurpose,withProviderPurpose} from '../../src/utils/provider-purpose-context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ analyze: vi.fn(), record: vi.fn() }));
vi.mock('../../src/services/openrouter-client', () => ({ analyzeViaOpenRouter: mocks.analyze }));
vi.mock('../../src/repositories/testnet.repository', () => ({
  recordSilentPipelineEvent: mocks.record,
}));

import { observeOpenRouterShadowDecision } from '../../src/services/openrouter-shadow.service';

describe('observeOpenRouterShadowDecision', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.OPENROUTER_DISPATCH_MODEL = 'qwen/qwen3-30b-a3b-instruct-2507';
    process.env.OPENROUTER_SHADOW_MODEL = 'google/gemini-3.5-flash-lite';
    process.env.OPENROUTER_SHADOW_MIN_CONFIDENCE = '0.80';
    mocks.analyze.mockResolvedValue({
      bias: 'bearish', action: 'sell', confidence: 85, reason_summary: 'confirmed',
    });
    mocks.record.mockResolvedValue(1);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('records a normalized challenger decision without execution fields', async () => {
    await observeOpenRouterShadowDecision({
      systemPrompt: 'system', userPrompt: 'market',
      symbol: 'BTC', timeframe: '5m', decisionCandleOpenMs: 123,
      primaryAnalysis: { bias: 'neutral', action: 'hold', confidence: 0.6 },
    });
    expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({
      model: 'google/gemini-3.5-flash-lite', responseFormat: 'json_object', maxParseRetries: 1,
    }));
    expect(mocks.record).toHaveBeenCalledWith('llm_model_shadow_decision', expect.objectContaining({
      confidence: 0.85, would_confirm: true, action: 'sell', primary_action: 'hold',
      symbol: 'BTC', timeframe: '5m', decision_candle_open_ms: 123,
    }));
  });

  it('does nothing when the challenger equals the primary model', async () => {
    process.env.OPENROUTER_SHADOW_MODEL = process.env.OPENROUTER_DISPATCH_MODEL;
    await observeOpenRouterShadowDecision({
      systemPrompt: 'system', userPrompt: 'market',
      symbol: 'BTC', timeframe: '5m',
      primaryAnalysis: { bias: 'neutral', action: 'hold', confidence: 0.6 },
    });
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
});

it('labels the actual shadow provider call and restores parent purpose',async()=>{
 process.env.OPENROUTER_DISPATCH_MODEL='primary';process.env.OPENROUTER_SHADOW_MODEL='shadow';
 mocks.analyze.mockImplementationOnce(async()=>{expect(currentProviderPurpose()).toBe('shadow');return {bias:'neutral',action:'hold',confidence:.5};});
 await withProviderPurpose('dispatch',async()=>{await observeOpenRouterShadowDecision({systemPrompt:'system',userPrompt:'market',symbol:'BTC',timeframe:'5m',primaryAnalysis:{bias:'neutral',action:'hold',confidence:.5}});expect(currentProviderPurpose()).toBe('dispatch');});
 expect(currentProviderPurpose()).toBeNull();
});

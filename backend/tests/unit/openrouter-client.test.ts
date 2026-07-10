import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isOpenRouterDispatchFallbackEnabled,
  OPENROUTER_MODEL_SCOUT_DEFAULT,
} from '../../src/config/openrouter-models';
import { analyzeViaOpenRouter } from '../../src/services/openrouter-client';

describe('openrouter-models', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('enables fallback when API key is set', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    delete process.env.OPENROUTER_DISPATCH_FALLBACK_ENABLED;
    expect(isOpenRouterDispatchFallbackEnabled()).toBe(true);
  });

  it('disables fallback when explicitly false', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.OPENROUTER_DISPATCH_FALLBACK_ENABLED = 'false';
    expect(isOpenRouterDispatchFallbackEnabled()).toBe(false);
  });
});

describe('analyzeViaOpenRouter', () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.OPENROUTER_DISPATCH_MODEL = OPENROUTER_MODEL_SCOUT_DEFAULT;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
    fetchMock.mockReset();
  });

  it('sends json_object response_format and OpenRouter headers', async () => {
    const analysis = {
      bias: 'bullish',
      action: 'long',
      confidence: 0.8,
      suggested_entry: 95000,
      suggested_stop_loss: 94000,
      suggested_take_profit: 97000,
    };

    fetchMock.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(analysis) } }],
        }),
    });

    const result = await analyzeViaOpenRouter({
      systemPrompt: 'sys',
      userPrompt: 'user',
    });

    expect(result.action).toBe('long');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-or-test');
    expect(headers['HTTP-Referer']).toBeTruthy();
    expect(headers['X-Title']).toBeTruthy();
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe(OPENROUTER_MODEL_SCOUT_DEFAULT);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('throws when API key missing', async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(
      analyzeViaOpenRouter({ systemPrompt: 's', userPrompt: 'u' })
    ).rejects.toThrow('OPENROUTER_API_KEY not configured');
  });
});

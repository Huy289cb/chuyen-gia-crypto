import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isCerebrasDispatchFallbackEnabled } from '../../src/config/cerebras-models';
import { analyzeViaCerebras } from '../../src/services/cerebras-client';

describe('cerebras-models', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('enables fallback when API key is set', () => {
    process.env.CEREBRAS_API_KEY = 'csk-test';
    delete process.env.CEREBRAS_DISPATCH_FALLBACK_ENABLED;
    expect(isCerebrasDispatchFallbackEnabled()).toBe(true);
  });

  it('disables fallback when explicitly false', () => {
    process.env.CEREBRAS_API_KEY = 'csk-test';
    process.env.CEREBRAS_DISPATCH_FALLBACK_ENABLED = 'false';
    expect(isCerebrasDispatchFallbackEnabled()).toBe(false);
  });
});

describe('analyzeViaCerebras', () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    process.env.CEREBRAS_API_KEY = 'csk-test';
    process.env.CEREBRAS_DISPATCH_MODEL = 'gpt-oss-120b';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
    fetchMock.mockReset();
  });

  it('sends json_object response_format and parses dispatch JSON', async () => {
    const analysis = {
      bias: 'bullish',
      action: 'long',
      confidence: 0.82,
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

    const result = await analyzeViaCerebras({
      systemPrompt: 'sys',
      userPrompt: 'user',
    });

    expect(result.action).toBe('long');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('gpt-oss-120b');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.max_tokens).toBe(2048);
  });

  it('throws when API key missing', async () => {
    delete process.env.CEREBRAS_API_KEY;
    await expect(
      analyzeViaCerebras({ systemPrompt: 's', userPrompt: 'u' })
    ).rejects.toThrow('CEREBRAS_API_KEY not configured');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isOpenRouterDispatchFallbackEnabled,
  OPENROUTER_MODEL_SCOUT_DEFAULT,
} from '../../src/config/openrouter-models';
import {
  analyzeViaOpenRouter,
  extractOpenRouterMessageContent,
} from '../../src/services/openrouter-client';

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

describe('extractOpenRouterMessageContent', () => {
  it('reads string content', () => {
    expect(
      extractOpenRouterMessageContent({
        choices: [{ message: { content: '{"a":1}' } }],
      })
    ).toBe('{"a":1}');
  });

  it('joins multipart content arrays', () => {
    expect(
      extractOpenRouterMessageContent({
        choices: [
          {
            message: {
              content: [{ type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }],
            },
          },
        ],
      })
    ).toBe('{"a":1}');
  });

  it('returns empty on missing choices', () => {
    expect(extractOpenRouterMessageContent({})).toBe('');
  });
});

describe('analyzeViaOpenRouter', () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.OPENROUTER_DISPATCH_MODEL = OPENROUTER_MODEL_SCOUT_DEFAULT;
    process.env.OPENROUTER_JSON_RETRIES = '3';
    process.env.OPENROUTER_MAX_TOKENS = '4096';
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
    expect(headers).not.toHaveProperty('Apehorization');
    expect(headers['HTTP-Referer']).toBeTruthy();
    expect(headers['X-Title']).toBeTruthy();
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe(OPENROUTER_MODEL_SCOUT_DEFAULT);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.max_tokens).toBe(4096);
  });

  it('repairs unquoted keys from model content without retry', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"action":"long", confidence: 0.7, "bias":"bullish"}',
              },
            },
          ],
        }),
    });

    const result = await analyzeViaOpenRouter({
      systemPrompt: 'sys',
      userPrompt: 'user',
    });
    expect(result.action).toBe('long');
    expect(result.confidence).toBe(0.7);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retries on truncated JSON then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { content: '{"action":"long","reason":"cut' } }],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '{"action":"long","confidence":0.9,"bias":"bullish"}',
                },
              },
            ],
          }),
      });

    const result = await analyzeViaOpenRouter({
      systemPrompt: 'sys',
      userPrompt: 'user',
      maxParseRetries: 3,
    });
    expect(result.action).toBe('long');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init2] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body2 = JSON.parse(String(init2.body));
    expect(body2.temperature).toBe(0);
    expect(body2.messages[1].content).toContain('ONLY one valid');
  });

  it('throws after exhausting parse retries', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: 'not json at all' } }],
        }),
    });

    await expect(
      analyzeViaOpenRouter({
        systemPrompt: 's',
        userPrompt: 'u',
        maxParseRetries: 2,
      })
    ).rejects.toThrow(/Invalid JSON in OpenRouter response after 2 attempts/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws when API key missing', async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(
      analyzeViaOpenRouter({ systemPrompt: 's', userPrompt: 'u' })
    ).rejects.toThrow('OPENROUTER_API_KEY not configured');
  });

  it('parses raw newline reason without retry', async () => {
    const content = [
      '{',
      '  "action": "buy",',
      '  "confidence": 0.85,',
      '  "reason": "line1',
      'line2",',
      '  "bias": "bullish"',
      '}',
    ].join('\n');

    fetchMock.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content } }],
        }),
    });

    const result = await analyzeViaOpenRouter({
      systemPrompt: 'sys',
      userPrompt: 'user',
    });
    expect(result.action).toBe('buy');
    expect(result.reason).toContain('line1');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

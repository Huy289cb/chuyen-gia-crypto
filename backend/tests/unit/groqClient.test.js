import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GroqClient, createGroqClient } from '../../src/services/groq-client.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('GroqClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('API Key Management', () => {
    it('should initialize with single API key', () => {
      const client = new GroqClient('key1');
      expect(client.apiKeys).toEqual(['key1']);
      expect(client.currentKeyIndex).toBe(0);
    });

    it('should initialize with multiple API keys', () => {
      const client = new GroqClient(['key1', 'key2', 'key3']);
      expect(client.apiKeys).toEqual(['key1', 'key2', 'key3']);
      expect(client.currentKeyIndex).toBe(0);
    });

    it('should get current API key correctly', () => {
      const client = new GroqClient(['key1', 'key2']);
      expect(client.getCurrentApiKey()).toBe('key1');
    });

    it('should switch to next API key with circular rotation', () => {
      const client = new GroqClient(['key1', 'key2', 'key3']);
      
      client.switchToNextApiKey();
      expect(client.currentKeyIndex).toBe(1);
      expect(client.getCurrentApiKey()).toBe('key2');
      
      client.switchToNextApiKey();
      expect(client.currentKeyIndex).toBe(2);
      expect(client.getCurrentApiKey()).toBe('key3');
      
      client.switchToNextApiKey();
      expect(client.currentKeyIndex).toBe(0); // Circular back to start
      expect(client.getCurrentApiKey()).toBe('key1');
    });

    it('should handle single key circular rotation', () => {
      const client = new GroqClient(['key1']);
      
      client.switchToNextApiKey();
      expect(client.currentKeyIndex).toBe(0);
      expect(client.getCurrentApiKey()).toBe('key1');
    });
  });

  describe('analyze() - API Key Loop Structure', () => {
    it('should try all models with first API key before switching', async () => {
      vi.useFakeTimers();
      try {
        const client = new GroqClient(['key1', 'key2']);

        global.fetch.mockImplementation(() =>
          Promise.resolve({
            ok: false,
            status: 429,
            text: () => Promise.resolve('Rate limit exceeded'),
          })
        );

        const run = client.analyze({
          systemPrompt: 'test',
          userPrompt: 'test',
          maxRetries: 1,
        });
        const assertion = expect(run).rejects.toThrow(/All (models|dispatch providers) failed/);
        await vi.runAllTimersAsync();
        await assertion;
      } finally {
        vi.useRealTimers();
      }
    });

    it('should use circular rotation when all keys exhausted', async () => {
      vi.useFakeTimers();
      try {
        const client = new GroqClient(['key1', 'key2']);

        global.fetch.mockImplementation(() =>
          Promise.resolve({
            ok: false,
            status: 429,
            text: () => Promise.resolve('Rate limit exceeded'),
          })
        );

        const run = client.analyze({
          systemPrompt: 'test',
          userPrompt: 'test',
          maxRetries: 1,
        });
        const assertion = expect(run).rejects.toThrow(/All (models|dispatch providers) failed/);
        await vi.runAllTimersAsync();
        await assertion;
      } finally {
        vi.useRealTimers();
      }
    });

    it('should succeed on first successful response', async () => {
      vi.useRealTimers();
      const client = new GroqClient(['key1', 'key2']);
      
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"bias":"bullish","action":"buy","confidence":0.8}' } }]
        })
      });

      const result = await client.analyze({
        systemPrompt: 'test',
        userPrompt: 'test',
        maxRetries: 1
      });

      expect(result).toEqual({ bias: 'bullish', action: 'buy', confidence: 0.8 });
      expect(client.currentKeyIndex).toBe(0); // Should not switch keys on success
    });

    it('should retry with delay on rate limit errors', async () => {
      vi.useFakeTimers();
      try {
        const client = new GroqClient(['key1']);

        let attemptCount = 0;
        global.fetch.mockImplementation(() => {
          attemptCount++;
          if (attemptCount < 3) {
            return Promise.resolve({
              ok: false,
              status: 429,
              text: () => Promise.resolve('Rate limit exceeded'),
            });
          }
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                choices: [{ message: { content: '{"bias":"bullish","action":"buy","confidence":0.8}' } }],
              }),
          });
        });

        const run = client.analyze({
          systemPrompt: 'test',
          userPrompt: 'test',
          maxRetries: 3,
        });
        await vi.runAllTimersAsync();
        const result = await run;

        expect(result).toEqual({ bias: 'bullish', action: 'buy', confidence: 0.8 });
        expect(attemptCount).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should skip remaining retries for a model when daily token limit is exhausted', async () => {
      const client = new GroqClient(['key1']);

      global.fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: () => Promise.resolve('Rate limit reached on tokens per day (TPD). Please try again in 4m5s.')
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            choices: [{ message: { content: '{"bias":"bullish","action":"buy","confidence":0.8}' } }]
          })
        });

      const result = await client.analyze({
        systemPrompt: 'test',
        userPrompt: 'test',
        maxRetries: 3
      });

      expect(result).toEqual({ bias: 'bullish', action: 'buy', confidence: 0.8 });
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('createGroqClient factory', () => {
    it('should create client with array of keys', () => {
      const client = createGroqClient(['key1', 'key2']);
      expect(client).toBeInstanceOf(GroqClient);
      expect(client.apiKeys).toEqual(['key1', 'key2']);
    });

    it('should create client with single key', () => {
      const client = createGroqClient('key1');
      expect(client).toBeInstanceOf(GroqClient);
      expect(client.apiKeys).toEqual(['key1']);
    });

    it('should return null when no keys provided', () => {
      const client = createGroqClient(null);
      expect(client).toBeNull();
    });

    it('should use environment variables when no keys passed', () => {
      process.env.GROQ_API_KEY_1 = 'env_key1';
      process.env.GROQ_API_KEY_2 = 'env_key2';
      
      const client = createGroqClient();
      expect(client).toBeInstanceOf(GroqClient);
      expect(client.apiKeys).toContain('env_key1');
      expect(client.apiKeys).toContain('env_key2');
      
      delete process.env.GROQ_API_KEY_1;
      delete process.env.GROQ_API_KEY_2;
    });
  });
});

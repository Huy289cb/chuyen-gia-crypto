import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  GROQ_MODEL_PRIMARY_DEFAULT,
  GROQ_MODEL_FALLBACKS_DEFAULT,
  GROQ_MODEL_AUXILIARY_DEFAULT,
  GROQ_MODEL_LEVELS_ADAPTER_DEFAULT,
  getGroqPrimaryModel,
  getGroqModelChain,
  getGroqDispatchFallbackModels,
  getGroqLevelsAdapterModel,
  getGroqTelegramAiModel,
  getGroqAuxiliaryModelChain,
} from '../../src/config/groq-models';

describe('groq-models', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    delete process.env.GROQ_MODEL_PRIMARY;
    delete process.env.GROQ_MODEL;
    delete process.env.GROQ_MODEL_FALLBACKS;
    delete process.env.GROQ_MODEL_LEVELS_ADAPTER;
    delete process.env.GROQ_MODEL_AUXILIARY;
    delete process.env.TELEGRAM_AI_MODEL;
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('defaults primary to the production gpt-oss model', () => {
    expect(getGroqPrimaryModel()).toBe(GROQ_MODEL_PRIMARY_DEFAULT);
    expect(getGroqPrimaryModel()).toBe('openai/gpt-oss-120b');
    expect(getGroqModelChain()[0]).toBe('openai/gpt-oss-120b');
  });

  it('respects active env models, removes retired IDs, and dedupes fallbacks', () => {
    process.env.GROQ_MODEL_PRIMARY = 'qwen/qwen3.6-27b';
    process.env.GROQ_MODEL_FALLBACKS =
      'qwen/qwen3.6-27b,llama-3.1-8b-instant,openai/gpt-oss-20b';
    const chain = getGroqModelChain();
    expect(chain).toEqual(['qwen/qwen3.6-27b', 'openai/gpt-oss-20b']);
    expect(chain).not.toContain('llama-3.1-8b-instant');
  });

  it('falls back to defaults when env points at retired models', () => {
    process.env.GROQ_MODEL_PRIMARY = 'llama-3.3-70b-versatile';
    process.env.GROQ_MODEL_FALLBACKS = 'qwen/qwen3-32b,llama-3.1-8b-instant';
    process.env.GROQ_MODEL_LEVELS_ADAPTER = 'meta-llama/llama-4-scout';
    process.env.TELEGRAM_AI_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

    expect(getGroqModelChain()).toEqual([
      GROQ_MODEL_PRIMARY_DEFAULT,
      GROQ_MODEL_AUXILIARY_DEFAULT,
    ]);
    expect(getGroqLevelsAdapterModel()).toBe(GROQ_MODEL_LEVELS_ADAPTER_DEFAULT);
    expect(getGroqTelegramAiModel()).toBe(GROQ_MODEL_PRIMARY_DEFAULT);
  });

  it('uses default fallback list when env unset', () => {
    const chain = getGroqModelChain();
    expect(chain.slice(1)).toEqual([...GROQ_MODEL_FALLBACKS_DEFAULT]);
    expect(getGroqDispatchFallbackModels()).toEqual([...GROQ_MODEL_FALLBACKS_DEFAULT]);
  });

  it('resolves adapter and telegram models from env or defaults', () => {
    expect(getGroqLevelsAdapterModel()).toBe(GROQ_MODEL_LEVELS_ADAPTER_DEFAULT);
    expect(getGroqTelegramAiModel()).toBe(GROQ_MODEL_PRIMARY_DEFAULT);

    process.env.GROQ_MODEL_LEVELS_ADAPTER = 'openai/gpt-oss-20b';
    process.env.TELEGRAM_AI_MODEL = 'qwen/qwen3.6-27b';
    expect(getGroqLevelsAdapterModel()).toBe('openai/gpt-oss-20b');
    expect(getGroqTelegramAiModel()).toBe('qwen/qwen3.6-27b');
  });

  it('auxiliary chain uses cheap production model then 120b fallback', () => {
    expect(getGroqAuxiliaryModelChain(2)).toEqual([
      GROQ_MODEL_AUXILIARY_DEFAULT,
      GROQ_MODEL_PRIMARY_DEFAULT,
    ]);
  });
});

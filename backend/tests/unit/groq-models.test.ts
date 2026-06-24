import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  GROQ_MODEL_PRIMARY_DEFAULT,
  GROQ_MODEL_FALLBACKS_DEFAULT,
  getGroqPrimaryModel,
  getGroqModelChain,
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
    delete process.env.TELEGRAM_AI_MODEL;
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('defaults primary to gpt-oss-120b (not deprecated scout)', () => {
    expect(getGroqPrimaryModel()).toBe(GROQ_MODEL_PRIMARY_DEFAULT);
    expect(getGroqPrimaryModel()).toBe('openai/gpt-oss-120b');
    expect(getGroqModelChain()[0]).toBe('openai/gpt-oss-120b');
    expect(getGroqModelChain()).not.toContain('meta-llama/llama-4-scout-17b-16e-instruct');
  });

  it('respects GROQ_MODEL_PRIMARY and dedupes fallbacks', () => {
    process.env.GROQ_MODEL_PRIMARY = 'llama-3.3-70b-versatile';
    process.env.GROQ_MODEL_FALLBACKS = 'llama-3.3-70b-versatile,llama-3.1-8b-instant';
    const chain = getGroqModelChain();
    expect(chain[0]).toBe('llama-3.3-70b-versatile');
    expect(chain.filter((m) => m === 'llama-3.3-70b-versatile')).toHaveLength(1);
    expect(chain[1]).toBe('llama-3.1-8b-instant');
  });

  it('uses default fallback list when env unset', () => {
    const chain = getGroqModelChain();
    expect(chain.slice(1)).toEqual([...GROQ_MODEL_FALLBACKS_DEFAULT]);
  });

  it('resolves adapter and telegram models from env or primary', () => {
    expect(getGroqLevelsAdapterModel()).toBe(GROQ_MODEL_PRIMARY_DEFAULT);
    expect(getGroqTelegramAiModel()).toBe(GROQ_MODEL_PRIMARY_DEFAULT);

    process.env.GROQ_MODEL_LEVELS_ADAPTER = 'llama-3.1-8b-instant';
    process.env.TELEGRAM_AI_MODEL = 'qwen/qwen3.6-27b';
    expect(getGroqLevelsAdapterModel()).toBe('llama-3.1-8b-instant');
    expect(getGroqTelegramAiModel()).toBe('qwen/qwen3.6-27b');
  });

  it('auxiliary chain returns primary + first fallback', () => {
    expect(getGroqAuxiliaryModelChain(2)).toEqual([
      GROQ_MODEL_PRIMARY_DEFAULT,
      GROQ_MODEL_FALLBACKS_DEFAULT[0],
    ]);
  });
});

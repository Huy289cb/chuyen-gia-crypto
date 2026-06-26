/**
 * Groq model IDs — centralized (Llama 4 Scout deprecated 2026-07-17).
 * @see https://console.groq.com/docs/models
 */

/** Best dispatch JSON reliability in production so far; switch before 2026-07-17. */
export const GROQ_MODEL_SCOUT = 'meta-llama/llama-4-scout-17b-16e-instruct';

/** Default dispatch primary while Scout is still available. */
export const GROQ_MODEL_PRIMARY_DEFAULT = GROQ_MODEL_SCOUT;

/** Post-Scout primary candidate (set via env after deprecation). */
export const GROQ_MODEL_POST_SCOUT_PRIMARY = 'llama-3.3-70b-versatile';

/** Fallback chain when primary fails (JSON reliability + rate limits). No gpt-oss here — empty body on long dispatch prompts. */
export const GROQ_MODEL_FALLBACKS_DEFAULT = [
  'llama-3.3-70b-versatile',
  'qwen/qwen3-32b',
  'qwen/qwen3.6-27b',
  'llama-3.1-8b-instant',
] as const;

/** Default for short SL/TP repair JSON (gpt-oss works on small prompts). */
export const GROQ_MODEL_LEVELS_ADAPTER_DEFAULT = 'openai/gpt-oss-120b';

/** Models to compare in scripts/benchmark-groq-dispatch-models.ts */
export const GROQ_DISPATCH_BENCHMARK_MODELS = [
  GROQ_MODEL_SCOUT,
  GROQ_MODEL_POST_SCOUT_PRIMARY,
  'qwen/qwen3-32b',
  'qwen/qwen3.6-27b',
] as const;

export function getGroqPrimaryModel(): string {
  return (
    process.env.GROQ_MODEL_PRIMARY?.trim() ||
    process.env.GROQ_MODEL?.trim() ||
    GROQ_MODEL_PRIMARY_DEFAULT
  );
}

export function parseGroqFallbackModels(): string[] {
  const raw = process.env.GROQ_MODEL_FALLBACKS?.trim();
  if (!raw) {
    return [...GROQ_MODEL_FALLBACKS_DEFAULT];
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Primary first, then fallbacks (deduped). */
export function getGroqModelChain(): string[] {
  const primary = getGroqPrimaryModel();
  const rest = parseGroqFallbackModels().filter((m) => m !== primary);
  return [primary, ...rest];
}

export function getGroqLevelsAdapterModel(): string {
  return (
    process.env.GROQ_MODEL_LEVELS_ADAPTER?.trim() ||
    GROQ_MODEL_LEVELS_ADAPTER_DEFAULT
  );
}

export function getGroqTelegramAiModel(): string {
  return process.env.TELEGRAM_AI_MODEL?.trim() || getGroqPrimaryModel();
}

/** Short chain for auxiliary JSON calls (flip eval, etc.). */
export function getGroqAuxiliaryModelChain(limit = 2): string[] {
  return getGroqModelChain().slice(0, Math.max(1, limit));
}

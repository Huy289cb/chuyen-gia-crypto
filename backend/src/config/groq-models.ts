/**
 * Groq model IDs — centralized (Llama 4 Scout deprecated 2026-07-17).
 * @see https://console.groq.com/docs/models
 */

/** Default primary after Scout deprecation. */
export const GROQ_MODEL_PRIMARY_DEFAULT = 'openai/gpt-oss-120b';

/** Fallback chain when primary fails (JSON reliability + rate limits). */
export const GROQ_MODEL_FALLBACKS_DEFAULT = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'qwen/qwen3.6-27b',
  'qwen/qwen3-32b',
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
  return process.env.GROQ_MODEL_LEVELS_ADAPTER?.trim() || getGroqPrimaryModel();
}

export function getGroqTelegramAiModel(): string {
  return process.env.TELEGRAM_AI_MODEL?.trim() || getGroqPrimaryModel();
}

/** Short chain for auxiliary JSON calls (flip eval, etc.). */
export function getGroqAuxiliaryModelChain(limit = 2): string[] {
  return getGroqModelChain().slice(0, Math.max(1, limit));
}

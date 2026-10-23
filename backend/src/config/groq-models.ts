/**
 * Groq model IDs — centralized.
 * @see https://console.groq.com/docs/models
 * @see https://console.groq.com/docs/deprecations
 */

/** Historical export kept for scripts/import compatibility; retired on 2026-07-17. */
export const GROQ_MODEL_SCOUT = 'meta-llama/llama-4-scout-17b-16e-instruct';

/** Production JSON model recommended by Groq after the Llama/Qwen retirements. */
export const GROQ_MODEL_PRIMARY_DEFAULT = 'openai/gpt-oss-120b';

/** Cheap production model for short auxiliary JSON calls. */
export const GROQ_MODEL_AUXILIARY_DEFAULT = 'openai/gpt-oss-20b';

/** Kept as a non-retired comparison candidate for existing benchmark callers. */
export const GROQ_MODEL_POST_SCOUT_PRIMARY = GROQ_MODEL_PRIMARY_DEFAULT;

/** Production fallback only; preview models are not part of the default live chain. */
export const GROQ_MODEL_FALLBACKS_DEFAULT = [GROQ_MODEL_AUXILIARY_DEFAULT] as const;

/** IDs that now return model_not_found for free/developer accounts. */
export const GROQ_RETIRED_MODEL_IDS = new Set([
  GROQ_MODEL_SCOUT,
  'meta-llama/llama-4-scout',
  'qwen/qwen3-32b',
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
]);

/** Default for short SL/TP repair JSON (gpt-oss works on small prompts). */
export const GROQ_MODEL_LEVELS_ADAPTER_DEFAULT = 'openai/gpt-oss-120b';

/** Models to compare in scripts/benchmark-groq-dispatch-models.ts */
export const GROQ_DISPATCH_BENCHMARK_MODELS = [
  GROQ_MODEL_PRIMARY_DEFAULT,
  GROQ_MODEL_AUXILIARY_DEFAULT,
  'qwen/qwen3.6-27b',
] as const;

function isUsableGroqModel(model: string | undefined): model is string {
  const normalized = model?.trim();
  return Boolean(normalized) && !GROQ_RETIRED_MODEL_IDS.has(normalized as string);
}

function dedupe(models: string[]): string[] {
  return [...new Set(models)];
}

export function getGroqPrimaryModel(): string {
  const configured =
    process.env.GROQ_MODEL_PRIMARY?.trim() ||
    process.env.GROQ_MODEL?.trim();
  return isUsableGroqModel(configured) ? configured : GROQ_MODEL_PRIMARY_DEFAULT;
}

export function parseGroqFallbackModels(): string[] {
  const raw = process.env.GROQ_MODEL_FALLBACKS?.trim();
  if (!raw) {
    return [...GROQ_MODEL_FALLBACKS_DEFAULT];
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(isUsableGroqModel);
}

/** Groq fallbacks only (excludes primary Scout). */
export function getGroqDispatchFallbackModels(): string[] {
  const primary = getGroqPrimaryModel();
  const configured = parseGroqFallbackModels().filter((m) => m !== primary);
  return configured.length > 0
    ? configured
    : GROQ_MODEL_FALLBACKS_DEFAULT.filter((m) => m !== primary);
}

/** Primary first, then fallbacks (deduped). */
export function getGroqModelChain(): string[] {
  const primary = getGroqPrimaryModel();
  return dedupe([primary, ...getGroqDispatchFallbackModels()]);
}

export function getGroqLevelsAdapterModel(): string {
  const configured = process.env.GROQ_MODEL_LEVELS_ADAPTER?.trim();
  return isUsableGroqModel(configured) ? configured : GROQ_MODEL_LEVELS_ADAPTER_DEFAULT;
}

export function getGroqTelegramAiModel(): string {
  const configured = process.env.TELEGRAM_AI_MODEL?.trim();
  return isUsableGroqModel(configured) ? configured : getGroqPrimaryModel();
}

/** Short chain for auxiliary JSON calls (flip eval, etc.). */
export function getGroqAuxiliaryModelChain(limit = 2): string[] {
  const configured = process.env.GROQ_MODEL_AUXILIARY?.trim();
  const auxiliary = isUsableGroqModel(configured)
    ? configured
    : GROQ_MODEL_AUXILIARY_DEFAULT;
  return dedupe([
    auxiliary,
    GROQ_MODEL_PRIMARY_DEFAULT,
    ...getGroqModelChain(),
  ]).slice(0, Math.max(1, limit));
}

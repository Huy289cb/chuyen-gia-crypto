/** OpenRouter dispatch fallback configuration (no service imports). */

/** Paid Scout on OpenRouter (not the :free variant). */
export const OPENROUTER_MODEL_SCOUT_DEFAULT = 'meta-llama/llama-4-scout';

export function isOpenRouterDispatchFallbackEnabled(): boolean {
  if (process.env.OPENROUTER_DISPATCH_FALLBACK_ENABLED === 'false') return false;
  return !!process.env.OPENROUTER_API_KEY?.trim();
}

export function getOpenRouterDispatchModel(): string {
  return process.env.OPENROUTER_DISPATCH_MODEL?.trim() || OPENROUTER_MODEL_SCOUT_DEFAULT;
}

export function getOpenRouterAppHeaders(): Record<string, string> {
  const referer =
    process.env.OPENROUTER_HTTP_REFERER?.trim() || 'https://download-money-moi.vercel.app';
  const title = process.env.OPENROUTER_APP_TITLE?.trim() || 'chuyen-gia-crypto';
  return {
    'HTTP-Referer': referer,
    'X-Title': title,
  };
}

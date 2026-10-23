/** OpenRouter dispatch fallback configuration (no service imports). */

/** JSON-capable paid model verified against the configured OpenRouter account. */
export const OPENROUTER_MODEL_SCOUT_DEFAULT = 'qwen/qwen3-30b-a3b-instruct-2507';

export type LlmProvider = 'groq' | 'openrouter';

/** Default groq for develop; mainnet VPS sets LLM_PROVIDER=openrouter. */
export function getLlmProvider(): LlmProvider {
  const provider = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (provider === 'openrouter') return 'openrouter';
  return 'groq';
}

export function isOpenRouterPrimaryProvider(): boolean {
  return getLlmProvider() === 'openrouter' && isOpenRouterDispatchFallbackEnabled();
}

export function isOpenRouterDispatchFallbackEnabled(): boolean {
  if (process.env.OPENROUTER_DISPATCH_FALLBACK_ENABLED === 'false') return false;
  return !!process.env.OPENROUTER_API_KEY?.trim();
}

export function getOpenRouterDispatchModel(): string {
  return process.env.OPENROUTER_DISPATCH_MODEL?.trim() || OPENROUTER_MODEL_SCOUT_DEFAULT;
}

/** Optional no-execution challenger. Empty or equal to primary disables it. */
export function getOpenRouterShadowModel(): string | null {
  const model = process.env.OPENROUTER_SHADOW_MODEL?.trim();
  if (!model || model === getOpenRouterDispatchModel()) return null;
  return model;
}

export function getOpenRouterLevelsAdapterModel(): string {
  return (
    process.env.OPENROUTER_LEVELS_ADAPTER_MODEL?.trim() ||
    process.env.OPENROUTER_DISPATCH_MODEL?.trim() ||
    OPENROUTER_MODEL_SCOUT_DEFAULT
  );
}

export function getLevelsAdapterProvider(): 'groq' | 'openrouter' {
  const explicit = process.env.LEVELS_ADAPTER_PROVIDER?.trim().toLowerCase();
  if (explicit === 'openrouter' || explicit === 'groq') return explicit;
  if (getLlmProvider() === 'openrouter') return 'openrouter';
  return 'groq';
}

export function isOpenRouterLevelsAdapterProvider(): boolean {
  return getLevelsAdapterProvider() === 'openrouter';
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

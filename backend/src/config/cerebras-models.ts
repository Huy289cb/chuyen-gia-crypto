/** Cerebras dispatch fallback configuration (no service imports). */

export const CEREBRAS_DISPATCH_MODEL_DEFAULT = 'gpt-oss-120b';

export function isCerebrasDispatchFallbackEnabled(): boolean {
  if (process.env.CEREBRAS_DISPATCH_FALLBACK_ENABLED === 'false') return false;
  return !!process.env.CEREBRAS_API_KEY?.trim();
}

export function getCerebrasDispatchModel(): string {
  return process.env.CEREBRAS_DISPATCH_MODEL?.trim() || CEREBRAS_DISPATCH_MODEL_DEFAULT;
}

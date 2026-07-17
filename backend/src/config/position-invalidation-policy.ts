/**
 * Position invalidation — structure-based tighten (Phase A).
 * See docs/position-invalidation-plan.md
 */

function envFloat(name: string, fallback: number): number {
  const v = parseFloat(process.env[name] || String(fallback));
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

function envInt(name: string, fallback: number): number {
  const v = parseInt(process.env[name] || String(fallback), 10);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** Master switch — default on. */
export function isInvalidationEnabled(): boolean {
  return process.env.INVALIDATION_ENABLED !== 'false';
}

export function getInvalidationMinScore(): number {
  return envFloat('INVALIDATION_MIN_SCORE', 2);
}

export function getInvalidationMinMinutes(): number {
  return envInt('INVALIDATION_MIN_MINUTES', 30);
}

/** Require at least this unrealized % before BE tighten. */
export function getInvalidationMinUpnlPct(): number {
  return envFloat('INVALIDATION_MIN_UPNL_PCT', 0.15);
}

/** Soft signal: HTF lost trend after this many hours + weak R. */
export function getInvalidationHtfLostMinHours(): number {
  return envFloat('INVALIDATION_HTF_LOST_MIN_HOURS', 6);
}

export function getInvalidationCooldownMs(): number {
  return envInt('INVALIDATION_COOLDOWN_MS', 900_000);
}

/** Primary TF for HTF regime / trendDirection (default 1h). */
export function getInvalidationHtfTf(): string {
  return process.env.INVALIDATION_HTF_TF?.trim() || '1h';
}

/** Secondary TF for adverse sweep/breakout (default 15m). */
export function getInvalidationLtfTf(): string {
  return process.env.INVALIDATION_LTF_TF?.trim() || '15m';
}

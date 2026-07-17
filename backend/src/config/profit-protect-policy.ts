/**
 * Profit protection: move exchange SL to breakeven / trail winners.
 * Does not cancel TP; only tightens stop_loss.
 */

function envFloat(name: string, fallback: number): number {
  const v = parseFloat(process.env[name] || String(fallback));
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

function envInt(name: string, fallback: number): number {
  const v = parseInt(process.env[name] || String(fallback), 10);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** Master switch — default on for live PnL protection. */
export function isProfitProtectEnabled(): boolean {
  return process.env.PROFIT_PROTECT_ENABLED !== 'false';
}

/** Move SL to entry once unrealized profit >= this many R (entry→original SL). */
export function getBreakevenAtR(): number {
  return envFloat('PROFIT_PROTECT_BE_AT_R', 1);
}

/** Activate trailing when unrealized PnL % of entry reaches this. */
export function getTrailActivatePct(): number {
  return envFloat('PROFIT_PROTECT_TRAIL_ACTIVATE_PCT', 1.5);
}

/** Trail distance behind mark (percent of price). */
export function getTrailDistancePct(): number {
  return envFloat('PROFIT_PROTECT_TRAIL_DISTANCE_PCT', 0.8);
}

/** Ignore tiny SL improvements (percent of entry). */
export function getMinSlMovePct(): number {
  return envFloat('PROFIT_PROTECT_MIN_SL_MOVE_PCT', 0.05);
}

/** Min position age before first SL tighten (minutes). */
export function getProfitProtectMinMinutes(): number {
  return envInt('PROFIT_PROTECT_MIN_MINUTES', 15);
}

/**
 * After this many hours, if still green but below BE threshold, nudge SL to entry.
 * 0 = disabled.
 */
export function getTimeStopHours(): number {
  return envInt('PROFIT_PROTECT_TIME_STOP_HOURS', 24);
}

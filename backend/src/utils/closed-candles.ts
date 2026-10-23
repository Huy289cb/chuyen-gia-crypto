/**
 * Helpers for hard gates that must only consume completed OHLCV bars.
 * Unified candle timestamps are Binance bar-open times.
 */

const TIMEFRAME_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

export function timeframeDurationMs(timeframe: string): number | null {
  return TIMEFRAME_MS[timeframe.toLowerCase()] ?? null;
}

/**
 * Binance can briefly return a still-mutating kline at the exact close boundary.
 * Keep a small finalization buffer so scanners never consume that transient OHLC.
 */
export const DEFAULT_CLOSED_CANDLE_GRACE_MS = 5_000;

export function getClosedCandleFinalizationGraceMs(): number {
  const raw = process.env.CLOSED_CANDLE_FINALIZATION_GRACE_MS?.trim();
  if (!raw) return DEFAULT_CLOSED_CANDLE_GRACE_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CLOSED_CANDLE_GRACE_MS;
}

/**
 * Return only bars whose full timeframe elapsed by `nowMs`.
 * Unknown timeframes fail closed instead of treating an active bar as complete.
 */
export function closedCandlesOnly<T extends { timestamp: number }>(
  candles: readonly T[],
  timeframe: string,
  nowMs: number = Date.now(),
  graceMs: number = getClosedCandleFinalizationGraceMs()
): T[] {
  const timeframeMs = timeframeDurationMs(timeframe);
  if (!timeframeMs || !Number.isFinite(nowMs) || !Number.isFinite(graceMs) || graceMs < 0) {
    return [];
  }

  return candles.filter(
    (candle) =>
      Number.isFinite(candle.timestamp) && candle.timestamp + timeframeMs + graceMs <= nowMs
  );
}

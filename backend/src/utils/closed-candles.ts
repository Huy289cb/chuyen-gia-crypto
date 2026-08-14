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

/**
 * Return only bars whose full timeframe elapsed by `nowMs`.
 * Unknown timeframes fail closed instead of treating an active bar as complete.
 */
export function closedCandlesOnly<T extends { timestamp: number }>(
  candles: readonly T[],
  timeframe: string,
  nowMs: number = Date.now()
): T[] {
  const timeframeMs = TIMEFRAME_MS[timeframe.toLowerCase()];
  if (!timeframeMs || !Number.isFinite(nowMs)) return [];

  return candles.filter(
    (candle) =>
      Number.isFinite(candle.timestamp) && candle.timestamp + timeframeMs <= nowMs
  );
}

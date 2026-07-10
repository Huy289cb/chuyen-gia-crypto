/**
 * Normalize OHLCV rows for lightweight-charts (UTC seconds, sorted, deduped).
 */

export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export function normalizeChartCandles(
  candles: ChartCandle[]
): ChartCandle[] {
  const byTime = new Map<number, ChartCandle>();

  for (const candle of candles) {
    if (
      candle == null ||
      typeof candle.open !== 'number' ||
      typeof candle.high !== 'number' ||
      typeof candle.low !== 'number' ||
      typeof candle.close !== 'number'
    ) {
      continue;
    }

    let time = Number(candle.time);
    if (!Number.isFinite(time)) continue;
    // Accept ms timestamps from legacy paths
    if (time > 1e12) time = Math.floor(time / 1000);

    byTime.set(time, {
      time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });
  }

  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

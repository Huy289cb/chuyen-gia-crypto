import { fetchHistoricalCandlesPaginated } from '../services/price-fetcher';
import type { BacktestCandle } from './types';

const TF_MS: Record<string, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
};

function rawRowToCandle(row: number[]): BacktestCandle {
  return {
    timestamp: row[0],
    open: row[1],
    high: row[2],
    low: row[3],
    close: row[4],
    volume: row[5] ?? 0,
  };
}

export function candlesUpTo(candles: BacktestCandle[], ts: number): BacktestCandle[] {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].timestamp <= ts) lo = mid + 1;
    else hi = mid;
  }
  return candles.slice(0, lo);
}

export function estimateBarsForWeeks(timeframe: string, weeks: number): number {
  const ms = TF_MS[timeframe] ?? TF_MS['5m'];
  return Math.ceil((weeks * 7 * 24 * 60 * 60_000) / ms) + 200;
}

function estimateBarsForRange(timeframe: string, fromMs: number, toMs: number, extraBars = 200): number {
  const ms = TF_MS[timeframe] ?? TF_MS['5m'];
  return Math.ceil((toMs - fromMs) / ms) + extraBars;
}

export interface LoadedBacktestCandles {
  byTf: Record<string, BacktestCandle[]>;
  period: { start: Date; end: Date };
}

/**
 * Load OHLCV for backtest window + warmup from Binance Futures.
 */
export async function loadBacktestCandles(input: {
  symbol: string;
  weeks: number;
  timeframes: string[];
  startDate?: Date;
  endDate?: Date;
  extraWarmupBars5m?: number;
}): Promise<LoadedBacktestCandles> {
  const end = input.endDate ?? new Date();
  const start =
    input.startDate ?? new Date(end.getTime() - input.weeks * 7 * 24 * 60 * 60_000);

  const byTf: Record<string, BacktestCandle[]> = {};

  for (const tf of input.timeframes) {
    const warmupMs = (input.extraWarmupBars5m ?? 150) * TF_MS['5m'];
    const fromTs = start.getTime() - warmupMs;
    const limit = estimateBarsForRange(tf, fromTs, end.getTime());
    const raw = await fetchHistoricalCandlesPaginated(input.symbol, tf, limit);
    const all = raw.map(rawRowToCandle).filter((c) => c.timestamp > 0);
    byTf[tf] = all.filter((c) => c.timestamp >= fromTs && c.timestamp <= end.getTime());
  }

  const master = byTf['5m'] ?? Object.values(byTf)[0] ?? [];
  const inRange = master.filter((c) => c.timestamp >= start.getTime());
  const periodStart = inRange[0]?.timestamp ?? start.getTime();
  const periodEnd = inRange[inRange.length - 1]?.timestamp ?? end.getTime();

  return {
    byTf,
    period: { start: new Date(periodStart), end: new Date(periodEnd) },
  };
}

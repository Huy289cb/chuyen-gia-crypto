import { beforeEach, describe, expect, it, vi } from 'vitest';

const priceFetcherMocks = vi.hoisted(() => ({
  fetchHistoricalCandlesPaginated: vi.fn(),
}));

vi.mock('../../src/services/price-fetcher', () => ({
  fetchHistoricalCandlesPaginated: priceFetcherMocks.fetchHistoricalCandlesPaginated,
}));

import {
  closedCandlesUpTo,
  loadBacktestCandles,
  timeframeDurationMs,
  warmupStartTimestamp,
} from '../../src/backtest/candle-loader';
import type { BacktestCandle } from '../../src/backtest/types';

function candle(timestamp: number): BacktestCandle {
  return {
    timestamp,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
  };
}

function rawCandle(timestamp: number): number[] {
  return [timestamp, 100, 101, 99, 100, 1];
}

beforeEach(() => {
  priceFetcherMocks.fetchHistoricalCandlesPaginated.mockReset();
});

describe('backtest closed-candle alignment', () => {
  it('does not expose an unfinished 1h candle to a mid-hour decision', () => {
    const hour = timeframeDurationMs('1h');
    const at09 = Date.parse('2026-08-12T09:00:00Z');
    const at10 = Date.parse('2026-08-12T10:00:00Z');
    const candles = [candle(at09), candle(at10)];

    expect(closedCandlesUpTo(candles, at10 + 30 * 60_000, '1h')).toEqual([candle(at09)]);
    expect(closedCandlesUpTo(candles, at10 + hour, '1h')).toEqual(candles);
  });

  it('includes the just-closed 5m signal candle at its decision timestamp', () => {
    const at10 = Date.parse('2026-08-12T10:00:00Z');
    const current = candle(at10);

    expect(closedCandlesUpTo([current], at10 + timeframeDurationMs('5m'), '5m')).toEqual([
      current,
    ]);
  });

  it('caps structure history to the production-sized tail without reintroducing lookahead', () => {
    const fourHours = timeframeDurationMs('4h');
    const candles = Array.from({ length: 140 }, (_, index) => candle(index * fourHours));
    const decisionTs = 140 * fourHours;
    const selected = closedCandlesUpTo(candles, decisionTs, '4h', 120);

    expect(selected).toHaveLength(120);
    expect(selected[0].timestamp).toBe(20 * fourHours);
    expect(selected.at(-1)?.timestamp).toBe(139 * fourHours);
  });
});

describe('backtest per-timeframe warmup', () => {
  it('loads the requested number of bars independently for 1h and 4h', () => {
    const start = Date.parse('2026-08-12T00:00:00Z');

    expect(start - warmupStartTimestamp(start, '1h', 150)).toBe(
      150 * timeframeDurationMs('1h')
    );
    expect(start - warmupStartTimestamp(start, '4h', 150)).toBe(
      150 * timeframeDurationMs('4h')
    );
  });

  it('anchors the fetch at endDate and excludes a candle that has not closed by then', async () => {
    const start = new Date('2026-08-12T10:00:00Z');
    const end = new Date('2026-08-12T12:00:00Z');
    priceFetcherMocks.fetchHistoricalCandlesPaginated.mockResolvedValueOnce([
      rawCandle(Date.parse('2026-08-12T10:00:00Z')),
      rawCandle(Date.parse('2026-08-12T11:00:00Z')),
      rawCandle(Date.parse('2026-08-12T12:00:00Z')),
    ]);

    const loaded = await loadBacktestCandles({
      symbol: 'BTC',
      weeks: 1,
      timeframes: ['1h'],
      startDate: start,
      endDate: end,
      extraWarmupBarsPerTf: 0,
    });

    expect(priceFetcherMocks.fetchHistoricalCandlesPaginated).toHaveBeenCalledWith(
      'BTC',
      '1h',
      expect.any(Number),
      end.getTime()
    );
    expect(loaded.byTf['1h'].map((row) => row.timestamp)).toEqual([
      Date.parse('2026-08-12T10:00:00Z'),
      Date.parse('2026-08-12T11:00:00Z'),
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { closedCandlesOnly } from '../../src/utils/closed-candles';

describe('closedCandlesOnly', () => {
  it('keeps only fully elapsed and finalized 4h bars', () => {
    const now = Date.UTC(2026, 7, 14, 12, 0, 0);
    const candles = [
      { timestamp: now - 8 * 60 * 60_000, close: 1 },
      { timestamp: now - 4 * 60 * 60_000, close: 2 },
      { timestamp: now, close: 3 },
    ];

    expect(closedCandlesOnly(candles, '4h', now)).toEqual(candles.slice(0, 1));
    expect(closedCandlesOnly(candles, '4h', now + 5_000)).toEqual(candles.slice(0, 2));
  });

  it('allows an explicit zero grace for deterministic historical callers', () => {
    const now = Date.UTC(2026, 7, 14, 12, 0, 0);
    const candle = { timestamp: now - 5 * 60_000 };
    expect(closedCandlesOnly([candle], '5m', now, 0)).toEqual([candle]);
  });

  it('fails closed for an unknown timeframe', () => {
    expect(closedCandlesOnly([{ timestamp: 1 }], 'unknown', 10_000)).toEqual([]);
  });
});

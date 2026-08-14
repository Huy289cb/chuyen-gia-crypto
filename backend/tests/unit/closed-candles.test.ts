import { describe, expect, it } from 'vitest';
import { closedCandlesOnly } from '../../src/utils/closed-candles';

describe('closedCandlesOnly', () => {
  it('keeps only fully elapsed 4h bars', () => {
    const now = Date.UTC(2026, 7, 14, 12, 0, 0);
    const candles = [
      { timestamp: now - 8 * 60 * 60_000, close: 1 },
      { timestamp: now - 4 * 60 * 60_000, close: 2 },
      { timestamp: now, close: 3 },
    ];

    expect(closedCandlesOnly(candles, '4h', now)).toEqual(candles.slice(0, 2));
  });

  it('fails closed for an unknown timeframe', () => {
    expect(closedCandlesOnly([{ timestamp: 1 }], 'unknown', 10_000)).toEqual([]);
  });
});

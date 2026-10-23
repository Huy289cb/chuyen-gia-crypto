import { describe, it, expect } from 'vitest';
import { generateCandleBarKey, generateCandleHash } from '../../src/utils/candle-hash';

describe('candle-hash', () => {
  it('is stable when Binance revises OHLC for the same bar', () => {
    const candles = [
      { timestamp: 1, high: 1, low: 0.9, close: 1 },
      { timestamp: 2, high: 2, low: 1.9, close: 2 },
    ];
    const revised = [...candles.slice(0, -1), { timestamp: 2, high: 3, low: 1.8, close: 2.5 }];
    expect(generateCandleHash(candles)).toBe(generateCandleBarKey(revised));
    expect(generateCandleHash(candles)).toBe('bar:v2:2');
  });

  it('changes only when the bar-open timestamp changes', () => {
    expect(generateCandleBarKey([{ timestamp: 2 }])).not.toBe(
      generateCandleBarKey([{ timestamp: 3 }])
    );
  });
});

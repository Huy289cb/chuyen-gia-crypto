import { describe, it, expect } from 'vitest';
import { generateCandleHash } from '../../src/utils/candle-hash';

describe('candle-hash', () => {
  it('is deterministic for the same last candle', () => {
    const candles = [
      { timestamp: 1, high: 1, low: 0.9, close: 1 },
      { timestamp: 2, high: 2, low: 1.9, close: 2 },
    ];
    expect(generateCandleHash(candles)).toBe(generateCandleHash(candles));
    expect(generateCandleHash(candles)).toBe('2_2_1.9_2');
  });
});

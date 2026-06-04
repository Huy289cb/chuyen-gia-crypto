import { describe, expect, it } from 'vitest';
import { estimatePnl } from '../../src/services/binance-fill-pnl.service';

describe('binance-fill-pnl', () => {
  it('estimatePnl long profit when price rises', () => {
    expect(estimatePnl('long', 100, 110, 1)).toBe(10);
  });

  it('estimatePnl short profit when price falls', () => {
    expect(estimatePnl('short', 100, 90, 1)).toBe(10);
  });
});

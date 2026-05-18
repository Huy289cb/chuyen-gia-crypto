import { describe, expect, it } from 'vitest';
import {
  calculatePnlPercent,
  calculateUnrealizedPnl,
  isLongSide,
} from '../../src/services/position-mark';

describe('position-mark', () => {
  it('calculates short PnL when mark moves down', () => {
    const pnl = calculateUnrealizedPnl('short', 76_318.2, 76_200, -0.0262);
    expect(pnl).toBeGreaterThan(0);
  });

  it('calculates short PnL percent from price move', () => {
    const pct = calculatePnlPercent('short', 76_318.2, 76_200);
    expect(pct).toBeCloseTo(0.155, 2);
  });

  it('recognizes long sides', () => {
    expect(isLongSide('long')).toBe(true);
    expect(isLongSide('SHORT')).toBe(false);
  });
});

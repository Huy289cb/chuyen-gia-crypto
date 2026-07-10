import { describe, expect, it } from 'vitest';
import {
  calculatePnlPercent,
  calculateUnrealizedPnl,
  isLongSide,
  signedPositionQty,
} from '../../src/services/position-mark';

const ENTRY = 76_318.2;

describe('position-mark', () => {
  it('recognizes long sides', () => {
    expect(isLongSide('long')).toBe(true);
    expect(isLongSide('SHORT')).toBe(false);
  });

  it('short with negative qty: loss when mark rises', () => {
    const pnl = calculateUnrealizedPnl('short', ENTRY, 76_405.59, -0.0262);
    expect(pnl).toBeCloseTo(-2.29, 2);
  });

  it('short with negative qty: profit when mark falls', () => {
    const pnl = calculateUnrealizedPnl('short', ENTRY, 76_200, -0.0262);
    expect(pnl).toBeGreaterThan(0);
  });

  it('short with positive qty: loss when mark rises', () => {
    const pnl = calculateUnrealizedPnl('short', ENTRY, 76_405.59, 0.0262);
    expect(pnl).toBeCloseTo(-2.29, 2);
  });

  it('signedPositionQty preserves negative short size', () => {
    expect(signedPositionQty('short', -0.0262)).toBe(-0.0262);
    expect(signedPositionQty('short', 0.0262)).toBe(-0.0262);
    expect(signedPositionQty('long', 0.0262)).toBe(0.0262);
  });

  it('calculates short PnL percent from price move', () => {
    const pct = calculatePnlPercent('short', ENTRY, 76_200);
    expect(pct).toBeCloseTo(0.155, 2);
  });
});

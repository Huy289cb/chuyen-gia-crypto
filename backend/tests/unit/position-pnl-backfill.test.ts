import { describe, it, expect } from 'vitest';
import {
  calculatePositionPnl,
  resolveBackfillClosePrice,
} from '../../src/services/position-pnl-backfill.service';

describe('position-pnl-backfill', () => {
  it('resolveBackfillClosePrice prefers close then current then entry', () => {
    expect(
      resolveBackfillClosePrice({ close_price: 100, current_price: 90, entry_price: 80 })
    ).toBe(100);
    expect(
      resolveBackfillClosePrice({ close_price: null, current_price: 90, entry_price: 80 })
    ).toBe(90);
    expect(
      resolveBackfillClosePrice({ close_price: null, current_price: 0, entry_price: 80 })
    ).toBe(80);
  });

  it('calculatePositionPnl long and short', () => {
    expect(calculatePositionPnl('long', 100, 110, 0.1)).toBeCloseTo(1, 5);
    expect(calculatePositionPnl('short', 100, 90, 0.1)).toBeCloseTo(1, 5);
  });
});

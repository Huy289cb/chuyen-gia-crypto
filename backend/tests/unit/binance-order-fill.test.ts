import { describe, it, expect } from 'vitest';
import { resolveFillAvgPrice, resolveFillQty } from '../../src/services/binance-order-fill.service';

describe('resolveFillAvgPrice', () => {
  it('uses order.ap when present', () => {
    const price = resolveFillAvgPrice({ ap: '76320.5', z: '0.026', Z: '0' }, 0.026);
    expect(price).toBe(76320.5);
  });

  it('uses L when ap missing and Z is zero', () => {
    const price = resolveFillAvgPrice(
      { L: '76318.2', z: '0.0262', Z: '0' },
      0.0262,
      95000
    );
    expect(price).toBe(76318.2);
  });

  it('falls back to entry price', () => {
    const price = resolveFillAvgPrice({ z: '0.01', Z: '0' }, 0.01, 76000);
    expect(price).toBe(76000);
  });

  it('returns 0 when no valid source', () => {
    expect(resolveFillAvgPrice({}, 0)).toBe(0);
  });
});

describe('resolveFillQty', () => {
  it('prefers executedQty argument', () => {
    expect(resolveFillQty({ z: '0.01' }, 0.0262)).toBe(0.0262);
  });
});

import { describe, it, expect } from 'vitest';
import {
  evaluateNormalizedQuantity,
  normalizeToStepSize,
  ceilToStepSize,
  resolveQuantityForMinNotional,
} from '../../src/utils/order-quantity';

describe('order-quantity', () => {
  it('normalizes to step size', () => {
    expect(normalizeToStepSize(0.00645, 0.0001)).toBe(0.0064);
  });

  it('ceils to step size', () => {
    expect(ceilToStepSize(0.003107, 0.001)).toBe(0.004);
  });

  it('rejects zero after normalization', () => {
    const result = evaluateNormalizedQuantity(0.00005, { stepSize: 0.0001, minQty: 0.0001 });
    expect(result.valid).toBe(false);
    expect(result.normalizedQty).toBe(0);
  });

  it('accepts valid quantity', () => {
    const result = evaluateNormalizedQuantity(0.0256, { stepSize: 0.0001, minQty: 0.0001 });
    expect(result.valid).toBe(true);
    expect(result.normalizedQty).toBe(0.0256);
  });

  it('accepts floored qty slightly below min notional within tolerance', () => {
    const result = resolveQuantityForMinNotional({
      quantity: 200 / 64380,
      entryPrice: 64380,
      minNotionalUsd: 200,
      stepSize: 0.001,
      minQty: 0.001,
      tolerancePercent: 5,
    });
    expect(result.valid).toBe(true);
    expect(result.normalizedQty).toBe(0.003);
    expect(result.orderNotional).toBeCloseTo(193.14, 1);
  });

  it('rejects notional far below min even with tolerance', () => {
    const result = resolveQuantityForMinNotional({
      quantity: 0.002,
      entryPrice: 64380,
      minNotionalUsd: 200,
      stepSize: 0.001,
      minQty: 0.001,
      tolerancePercent: 5,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('well below minimum');
  });

  it('allows slight overrun of remaining capacity within tolerance', () => {
    const result = resolveQuantityForMinNotional({
      quantity: 200 / 64380,
      entryPrice: 64380,
      minNotionalUsd: 200,
      stepSize: 0.001,
      minQty: 0.001,
      maxNotionalUsd: 190,
      tolerancePercent: 5,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects notional far above remaining capacity', () => {
    const result = resolveQuantityForMinNotional({
      quantity: 200 / 64380,
      entryPrice: 64380,
      minNotionalUsd: 200,
      stepSize: 0.001,
      minQty: 0.001,
      maxNotionalUsd: 14,
      tolerancePercent: 5,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('exceeds remaining capacity');
  });
});

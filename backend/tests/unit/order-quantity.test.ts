import { describe, it, expect } from 'vitest';
import { evaluateNormalizedQuantity, normalizeToStepSize } from '../../src/utils/order-quantity';

describe('order-quantity', () => {
  it('normalizes to step size', () => {
    expect(normalizeToStepSize(0.00645, 0.0001)).toBe(0.0064);
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
});

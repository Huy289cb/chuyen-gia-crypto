import { describe, it, expect } from 'vitest';
import { computeExpectedRrFromPrices, reconcileExpectedRr } from '../../src/utils/trade-levels';

describe('computeExpectedRrFromPrices', () => {
  it('computes SHORT R:R from SL/TP', () => {
    const rr = computeExpectedRrFromPrices(76318.2, 76800, 75800);
    expect(rr).not.toBeNull();
    expect(rr!).toBeGreaterThan(1.0);
    expect(rr!).toBeLessThan(1.2);
  });

  it('computes LONG R:R', () => {
    const rr = computeExpectedRrFromPrices(100, 95, 110);
    expect(rr).toBe(2);
  });
});

describe('reconcileExpectedRr', () => {
  it('overwrites inflated LLM expected_rr', () => {
    const { analysis, rrCorrected } = reconcileExpectedRr({
      bias: 'bearish',
      action: 'sell',
      confidence: 0.88,
      suggested_entry: 76318.2,
      suggested_stop_loss: 76800,
      suggested_take_profit: 75800,
      expected_rr: 2.5,
    });
    expect(rrCorrected).toBe(true);
    expect(analysis.expected_rr).toBeGreaterThan(1);
    expect(analysis.expected_rr).toBeLessThan(1.2);
    expect(analysis.expected_rr).not.toBe(2.5);
  });
});

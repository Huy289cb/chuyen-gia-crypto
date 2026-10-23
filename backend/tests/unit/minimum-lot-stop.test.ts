import { describe, expect, it } from 'vitest';
import { normalizeMinimumLotStop } from '../../src/utils/minimum-lot-stop';

const base = {
  entry: 79_894.5,
  stopLoss: 78_730,
  takeProfit: 83_388,
  orderQty: 0.001,
  balance: 34.27714639,
  minSlPct: 0.008,
  maxEffectiveRiskPct: 2,
  minRr: 3,
  priceTickSize: 0.1,
  preferredMaxSlPct: 0.0084,
} as const;

describe('normalizeMinimumLotStop', () => {
  it('tightens a minimum-lot long into the feasible risk band and preserves R:R', () => {
    const result = normalizeMinimumLotStop({ ...base, action: 'buy' });

    expect(result?.adjusted).toBe(true);
    expect(result?.normalizedStopPct).toBeGreaterThanOrEqual(0.008 - 1e-9);
    expect(result?.normalizedStopPct).toBeLessThanOrEqual(0.0084 + 1e-9);
    expect(result?.normalizedStopPct).toBeLessThanOrEqual(result!.maxFeasibleStopPct + 1e-9);
    expect(result?.effectiveRiskPct).toBeLessThanOrEqual(2 + 1e-9);
    expect(result?.expectedRr).toBeGreaterThanOrEqual(3);
    expect(result!.stopLoss).toBeLessThan(base.entry);
    expect(result!.takeProfit).toBeGreaterThan(base.entry);
  });

  it('normalizes the symmetric short and rounds target outward', () => {
    const result = normalizeMinimumLotStop({
      ...base,
      action: 'sell',
      stopLoss: 81_059,
      takeProfit: 76_401,
    });

    expect(result?.adjusted).toBe(true);
    expect(result?.effectiveRiskPct).toBeLessThanOrEqual(2 + 1e-9);
    expect(result?.expectedRr).toBeGreaterThanOrEqual(3);
    expect(result!.stopLoss).toBeGreaterThan(base.entry);
    expect(result!.takeProfit).toBeLessThan(base.entry);
  });

  it('returns null when the wallet cannot support even the minimum stop', () => {
    const result = normalizeMinimumLotStop({
      ...base,
      action: 'buy',
      balance: 20,
    });

    expect(result).toBeNull();
  });

  it('leaves levels unchanged when the original stop already fits the cap', () => {
    const result = normalizeMinimumLotStop({
      ...base,
      action: 'buy',
      balance: 100,
    });

    expect(result).toEqual(expect.objectContaining({
      adjusted: false,
      stopLoss: base.stopLoss,
      takeProfit: base.takeProfit,
    }));
  });

  it('fails closed when price tick leaves no point inside the narrow feasible band', () => {
    const result = normalizeMinimumLotStop({
      ...base,
      action: 'buy',
      balance: 32.1,
      priceTickSize: 100,
    });

    expect(result).toBeNull();
  });
});

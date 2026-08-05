import { describe, expect, it } from 'vitest';
import {
  calcDailyLossPercent,
  calcDrawdownPercent,
} from '../../src/services/account-circuit.service';
import {
  profitFactorLabel,
  rollupExpectancyFromOutcomes,
} from '../../src/services/expectancy-rollup.service';

describe('account circuit math', () => {
  it('calcDailyLossPercent', () => {
    expect(calcDailyLossPercent(40, 38)).toBeCloseTo(5, 5);
    expect(calcDailyLossPercent(40, 40)).toBe(0);
    expect(calcDailyLossPercent(40, 42)).toBe(0);
    expect(calcDailyLossPercent(0, 10)).toBe(0);
  });

  it('calcDrawdownPercent', () => {
    expect(calcDrawdownPercent(40, 34)).toBeCloseTo(15, 5);
    expect(calcDrawdownPercent(40, 40)).toBe(0);
    expect(calcDrawdownPercent(40, 45)).toBe(0);
  });
});

describe('expectancy rollup', () => {
  it('computes avgR sumR PF', () => {
    const r = rollupExpectancyFromOutcomes([
      { realized_rr: 2, realized_pnl: 0.8 },
      { realized_rr: -1, realized_pnl: -0.4 },
      { realized_rr: -1, realized_pnl: -0.4 },
    ]);
    expect(r.n).toBe(3);
    expect(r.sumR).toBe(0);
    expect(r.avgR).toBe(0);
    expect(r.wins).toBe(1);
    expect(r.losses).toBe(2);
    expect(r.profitFactor).toBeCloseTo(0.8 / 0.8, 5);
  });

  it('kill threshold example: sumR <= -3 on 10 closes', () => {
    const rows = Array.from({ length: 10 }, () => ({
      realized_rr: -0.4,
      realized_pnl: -0.16,
    }));
    const r = rollupExpectancyFromOutcomes(rows);
    expect(r.n).toBe(10);
    expect(r.sumR).toBeCloseTo(-4, 5);
    expect(r.sumR <= -3).toBe(true);
  });

  it('profitFactorLabel', () => {
    expect(profitFactorLabel(null, 3, 0)).toBe('inf');
    expect(profitFactorLabel(1.5, 2, 1)).toBe('1.50');
    expect(profitFactorLabel(null, 0, 0)).toBe('n/a');
  });
});

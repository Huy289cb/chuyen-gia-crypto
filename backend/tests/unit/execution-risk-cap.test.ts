import { describe, expect, it } from 'vitest';
import { computeExecutionRisk, resolveExecutionRiskCapUsd } from '../../src/utils/execution-risk';

describe('fixed dollar execution risk ceiling', () => {
  it('keeps one dollar fixed as wallet changes and preserves percent mode when unset', () => {
    for (const balance of [25, 34.27714639, 100]) {
      expect(resolveExecutionRiskCapUsd({ balance, maxRiskPercent: 2, maxRiskUsd: 1 })).toBe(1);
      expect(resolveExecutionRiskCapUsd({ balance, maxRiskPercent: 2 })).toBeCloseTo(balance * .02);
    }
  });
  it('retains percent fallback for malformed dollar caps and rejects invalid equity', () => {
    for (const maxRiskUsd of [NaN, Infinity, 0, -1]) {
      expect(resolveExecutionRiskCapUsd({ balance: 34, maxRiskPercent: 2, maxRiskUsd })).toBe(.68);
    }
    for (const balance of [0, -1, NaN, Infinity]) {
      expect(resolveExecutionRiskCapUsd({ balance, maxRiskPercent: 2, maxRiskUsd: 1 })).toBe(0);
    }
  });
  it('counts costs: a 0.90 USDT price stop can exceed a 1 USDT total ceiling', () => {
    const risk = computeExecutionRisk({ entry: 79425, stopLoss: 78525, quantity: .001, balance: 34.27714639 });
    expect(risk.priceRiskUsd).toBeCloseTo(.9);
    expect(risk.totalRiskUsd).toBeGreaterThan(1);
  });
});

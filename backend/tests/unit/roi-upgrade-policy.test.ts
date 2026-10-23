import { describe, expect, it } from 'vitest';
import { DEFAULT_RISK_POLICY, type RiskPolicyConfig } from '../../src/config/risk-policy';
import { createRoiUpgradePolicyVariants } from '../../src/config/roi-upgrade-policy';
import { financialFeasibilityEnvelope } from '../../src/utils/financial-feasibility-envelope';
import { computeExecutionRisk, resolveExecutionRiskCapUsd } from '../../src/utils/execution-risk';
import { evaluateAccountCircuits } from '../../src/utils/account-circuit-evaluation';

const recorded: RiskPolicyConfig = { ...DEFAULT_RISK_POLICY,
  maxEffectiveRiskPerTradePercent: 3, maxEffectiveRiskPerTradeUsd: null,
  dailyLossLimitPercent: 10, minSlDistancePercent: 0.008, maxTotalExposureUsd: 100,
  consecutiveLossCooldownHours: 1, lossCooldownTier2Hours: 1, lossCooldownTier3Hours: 1,
  lossCooldownTier3UntilUtcDay: false, circuitExpectancyCooldownHours: 1,
  circuitPeakEquityOverride: 35.84, circuitExpectancySince: new Date('2026-08-12T16:00:00.000Z') };
const balance = 31.47744546, entry = 85895.6;

describe('explicit ROI upgrade research policy', () => {
  it('changes only the approved cap and drawdown blocker; preserves baseline, history and process env', () => {
    const before = JSON.stringify(recorded), envBefore = { ...process.env };
    const variants = createRoiUpgradePolicyVariants(recorded);
    const changes = Object.keys(recorded).filter(key =>
      JSON.stringify(variants.baseline.policy[key as keyof RiskPolicyConfig]) !==
      JSON.stringify(variants.candidate.policy[key as keyof RiskPolicyConfig]));
    expect(changes.sort()).toEqual(['circuitDrawdownEnabled', 'maxEffectiveRiskPerTradePercent']);
    expect(variants.candidate.role).toBe('research_only');
    expect(variants.candidate.policy.circuitPeakEquityOverride).toBe(35.84);
    expect(variants.candidate.policy.circuitExpectancySince?.toISOString()).toBe('2026-08-12T16:00:00.000Z');
    expect(JSON.stringify(recorded)).toBe(before);
    expect(process.env).toEqual(envBefore);
    expect(Object.isFrozen(variants.candidate.policy)).toBe(true);
    expect(variants.candidate.policy.circuitExpectancySince).not.toBe(recorded.circuitExpectancySince);
  });

  it.each([
    { maxEffectiveRiskPerTradeUsd: 1 }, { dailyLossLimitPercent: 3 },
    { minSlDistancePercent: 0.004 }, { lossCooldownTier2Hours: 6 },
    { maxTotalExposureUsd: 2000 }, { circuitDailyLossEnabled: false },
    { circuitExpectancyKillEnabled: false }, { minimumLotStopNormalizationEnabled: true },
  ])('rejects baseline drift instead of silently manufacturing pinned values: %j', patch => {
    expect(() => createRoiUpgradePolicyVariants({ ...recorded, ...patch })).toThrow('baseline_mismatch');
  });

  it('rejects unknown costs and expectancy inputs', () => {
    expect(() => createRoiUpgradePolicyVariants({ ...recorded, maxFeePercent: NaN })).toThrow();
    expect(() => createRoiUpgradePolicyVariants({ ...recorded, circuitExpectancyWindow: 0 })).toThrow();
  });

  it('makes a 1.5% structural stop fit 5% but not 3% without moving its price or quantity', () => {
    const { baseline, candidate } = createRoiUpgradePolicyVariants(recorded);
    for (const side of ['long', 'short']) {
      const stopLoss = entry * (side === 'long' ? 0.985 : 1.015);
      const risk = computeExecutionRisk({ entry, stopLoss, quantity: 0.001, balance });
      const cap = (p: RiskPolicyConfig | Readonly<RiskPolicyConfig>) => resolveExecutionRiskCapUsd({
        balance, maxRiskPercent: p.maxEffectiveRiskPerTradePercent, maxRiskUsd: p.maxEffectiveRiskPerTradeUsd });
      expect(risk.totalRiskUsd).toBeGreaterThan(cap(baseline.policy));
      expect(risk.totalRiskUsd).toBeLessThan(cap(candidate.policy));
    }
    expect(computeExecutionRisk({ entry, stopLoss: entry * 0.98, quantity: 0.001, balance }).riskPercent).toBeGreaterThan(6);
  });

  it('preserves daily/exposure blockers and unknown daily state in the wider envelope', () => {
    const { candidate } = createRoiUpgradePolicyVariants(recorded);
    const input = { entry, balance, minSlFraction: 0.008, feePercent: 0.1, slippagePercent: 0.1,
      maxRiskPercent: candidate.policy.maxEffectiveRiskPerTradePercent, maxRiskUsd: null,
      exposureUsd: 100, remainingDailyRiskUsd: 0.5,
      filters: { minQty: 0.001, maxQty: 100, stepSize: 0.001, minNotional: 50, tickSize: 0.1 } };
    expect(financialFeasibilityEnvelope(input).sides[0].blockers).toContain('daily_budget');
    expect(financialFeasibilityEnvelope({ ...input, exposureUsd: 80 }).sides[0].blockers).toContain('exposure');
    expect(financialFeasibilityEnvelope({ ...input, remainingDailyRiskUsd: null }).dailyBudgetKnown).toBe(false);
  });

  it('disables only drawdown: daily has priority and expectancy still blocks at the exact threshold', () => {
    const { baseline, candidate } = createRoiUpgradePolicyVariants(recorded);
    const state = { dailyLossPercent: 0, drawdownPercent: 40, expectancy: { n: 10, sumR: 1, avgR: 0.1 } };
    expect(evaluateAccountCircuits(baseline.policy, state).reason).toContain('Drawdown circuit');
    expect(evaluateAccountCircuits(candidate.policy, state).allowed).toBe(true);
    const losing = { ...state, expectancy: { n: 10, sumR: -3, avgR: -0.3 } };
    expect(evaluateAccountCircuits(candidate.policy, losing).reason).toContain('Expectancy kill:');
    expect(evaluateAccountCircuits(candidate.policy, { ...losing, dailyLossPercent: 10 }).reason).toContain('Daily loss circuit');
    expect(evaluateAccountCircuits(candidate.policy, { ...losing, expectancy: { n: 9, sumR: -3, avgR: -1 / 3 } }).allowed).toBe(true);
  });
});

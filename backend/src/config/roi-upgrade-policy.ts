import type { RiskPolicyConfig } from './risk-policy';

export const ROI_UPGRADE_POLICY_SCHEMA = 'roi-upgrade-policy-v1';
export const ROI_UPGRADE_PRIMARY_CAP_PERCENT = 5;

export interface RoiUpgradePolicyVariant {
  id: 'baseline_3pct_dd_on_v1' | 'research_5pct_dd_off_v1';
  role: 'recorded_baseline' | 'research_only';
  policy: Readonly<RiskPolicyConfig>;
  changedFields: readonly (keyof RiskPolicyConfig)[];
}

/**
 * Start from an explicit resolved baseline, never process.env or legacy defaults.
 * This returns research data; it does not apply policy to a worker or authorize orders.
 */
export function createRoiUpgradePolicyVariants(baseline: RiskPolicyConfig): {
  baseline: RoiUpgradePolicyVariant;
  candidate: RoiUpgradePolicyVariant;
} {
  const pinned: Partial<RiskPolicyConfig> = {
    maxEffectiveRiskPerTradePercent: 3,
    maxEffectiveRiskPerTradeUsd: null,
    riskPerTradePercent: 0.5,
    dailyLossLimitPercent: 10,
    minSlDistancePercent: 0.008,
    maxTotalExposureUsd: 100,
    maxExposurePercentOfEquity: null,
    consecutiveLossCooldownHours: 1,
    lossCooldownTier2Hours: 1,
    lossCooldownTier3Hours: 1,
    lossCooldownTier3UntilUtcDay: false,
    circuitExpectancyCooldownHours: 1,
    circuitDailyLossEnabled: true,
    circuitExpectancyKillEnabled: true,
    circuitDrawdownEnabled: true,
    maxDrawdownPercent: 15,
    minimumLotStopNormalizationEnabled: false,
  };
  for (const key of Object.keys(pinned) as (keyof RiskPolicyConfig)[]) {
    if (baseline[key] !== pinned[key]) throw new Error(`roi_upgrade_baseline_mismatch:${key}`);
  }
  if (!Number.isFinite(baseline.maxFeePercent) || baseline.maxFeePercent < 0.1 ||
    !Number.isFinite(baseline.maxSlippagePercent) || baseline.maxSlippagePercent < 0.1 ||
    !Number.isInteger(baseline.circuitExpectancyWindow) || baseline.circuitExpectancyWindow <= 0 ||
    !Number.isFinite(baseline.circuitExpectancyMinSumR)) {
    throw new Error('roi_upgrade_missing_baseline_cost_or_expectancy');
  }
  const clonePolicy = () => ({ ...baseline,
    circuitExpectancySince: baseline.circuitExpectancySince == null ? null :
      new Date(baseline.circuitExpectancySince.getTime()),
  });
  const recorded = Object.freeze(clonePolicy());
  const candidate = Object.freeze({ ...clonePolicy(),
    maxEffectiveRiskPerTradePercent: ROI_UPGRADE_PRIMARY_CAP_PERCENT,
    circuitDrawdownEnabled: false,
  });
  return {
    baseline: { id: 'baseline_3pct_dd_on_v1', role: 'recorded_baseline',
      policy: recorded, changedFields: Object.freeze([]) },
    candidate: { id: 'research_5pct_dd_off_v1', role: 'research_only',
      policy: candidate,
      changedFields: Object.freeze(['maxEffectiveRiskPerTradePercent', 'circuitDrawdownEnabled'] as const) },
  };
}

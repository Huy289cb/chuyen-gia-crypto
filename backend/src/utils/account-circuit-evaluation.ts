import type { RiskPolicyConfig } from '../config/risk-policy';

export type AccountCircuitPolicy = Pick<RiskPolicyConfig,
  'circuitDailyLossEnabled' | 'dailyLossLimitPercent' |
  'circuitDrawdownEnabled' | 'maxDrawdownPercent' |
  'circuitExpectancyKillEnabled' | 'circuitExpectancyWindow' | 'circuitExpectancyMinSumR'>;

export interface AccountCircuitInputs {
  dailyLossPercent: number;
  drawdownPercent: number;
  expectancy: { n: number; sumR: number; avgR: number };
}

/** Same ordered gates for production and recorded replay; callers supply measured state. */
export function evaluateAccountCircuits(
  policy: AccountCircuitPolicy,
  state: AccountCircuitInputs,
): { allowed: boolean; reason: string } {
  if (policy.circuitDailyLossEnabled && state.dailyLossPercent >= policy.dailyLossLimitPercent) {
    return { allowed: false,
      reason: `Daily loss circuit ${state.dailyLossPercent.toFixed(2)}% >= ${policy.dailyLossLimitPercent}%` };
  }
  if (policy.circuitDrawdownEnabled && state.drawdownPercent >= policy.maxDrawdownPercent) {
    return { allowed: false,
      reason: `Drawdown circuit ${state.drawdownPercent.toFixed(2)}% >= ${policy.maxDrawdownPercent}% from peak` };
  }
  if (policy.circuitExpectancyKillEnabled &&
    state.expectancy.n >= policy.circuitExpectancyWindow &&
    state.expectancy.sumR <= policy.circuitExpectancyMinSumR) {
    return { allowed: false,
      reason: `Expectancy kill: last ${state.expectancy.n} closes sumR=${state.expectancy.sumR.toFixed(2)} ` +
        `<= ${policy.circuitExpectancyMinSumR} (avgR=${state.expectancy.avgR.toFixed(3)})` };
  }
  return { allowed: true, reason: 'circuits clear' };
}

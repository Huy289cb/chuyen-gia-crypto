import type { StructureBias } from '../config/v3-structure-bias-policy';
import type { SignalGateOutput } from '../services/signal-gate.service';
import { isRangeSweepTargetRoomRequired } from '../config/adaptive-setup-policy';
import { hasRangeTargetRoom } from './range-target-room';
import { computePolicyCompliantStopAndTarget } from './trade-levels';
import { getRiskPolicy } from '../config/risk-policy';

export interface RetestDispatchContext {
  candidateKey: string;
  candidateKind: string;
  side: 'long' | 'short';
  boundaryPrice: number;
  breakoutBarKey: string;
  confirmedEntryPrice: number;
  minRr: number;
  rangeLow?: number;
  rangeHigh?: number;
}

export function isOptimizedRangeRetest(context: RetestDispatchContext | undefined): boolean {
  return Boolean(
    context &&
      context.candidateKind === 'range_sweep_reclaim' &&
      context.side === 'long' &&
      Number.isFinite(context.confirmedEntryPrice) &&
      context.confirmedEntryPrice > 0 &&
      Math.abs(context.minRr - 1.5) < 1e-9
  );
}

/** Dedicated gate for the configured long-5m range policy; historical results are not live proof. */
export function validateOptimizedRangeRetest(input: {
  context: RetestDispatchContext;
  timeframe: string;
  signalResult?: SignalGateOutput;
  htf1h: { fresh: boolean; regime: string };
  structureBias: StructureBias;
}): { pass: boolean; reason: string } {
  if (!isOptimizedRangeRetest(input.context)) {
    return { pass: false, reason: 'adaptive range retest context is not live-policy eligible' };
  }
  if (input.timeframe !== '5m') {
    return { pass: false, reason: `adaptive range retest requires 5m, got ${input.timeframe}` };
  }
  const setup = input.signalResult?.setupResult;
  if (
    setup?.playbookKey !== 'liquidity_sweep_reclaim' ||
    (setup.grade !== 'A' && setup.grade !== 'B')
  ) {
    return { pass: false, reason: 'adaptive range retest requires A/B liquidity sweep evidence' };
  }
  if (!input.htf1h.fresh || input.htf1h.regime !== 'range') {
    return { pass: false, reason: `adaptive range retest requires fresh 1h range, got ${input.htf1h.regime}` };
  }
  if (input.structureBias === 'bear') {
    return { pass: false, reason: 'adaptive range long blocked by 4h bear structure' };
  }
  if (isRangeSweepTargetRoomRequired()) {
    const levels = computePolicyCompliantStopAndTarget({ action: 'buy',
      entry: input.context.confirmedEntryPrice, minSlPct: getRiskPolicy().minSlDistancePercent,
      minRr: input.context.minRr });
    if (!levels || !hasRangeTargetRoom({ side: 'long', entry: input.context.confirmedEntryPrice,
      target: levels.takeProfit, rangeLow: input.context.rangeLow!, rangeHigh: input.context.rangeHigh! })) {
      return { pass: false, reason: 'adaptive range target exceeds observed range or bounds unavailable' };
    }
  }
  return {
    pass: true,
    reason: `validated range long 5m: 1h range, 4h ${input.structureBias}, RR1.5`,
  };
}

/** Keep the model's review contract aligned with the levels execution will actually use. */
export function buildRangeRetestReviewPrompt(input: {
  systemPrompt: string;
  context: RetestDispatchContext;
  stopLoss: number;
  takeProfit: number;
}): { systemPrompt: string; userContext: string } {
  const { context, stopLoss, takeProfit } = input;
  if (!isOptimizedRangeRetest(context) || !Number.isFinite(stopLoss) ||
      !Number.isFinite(takeProfit) || !(stopLoss > 0 && stopLoss < context.confirmedEntryPrice &&
      context.confirmedEntryPrice < takeProfit)) {
    throw new Error('Invalid range review contract');
  }
  return {
    systemPrompt: input.systemPrompt +
      `\n\nAPPROVED RANGE RETEST REVIEW CONTRACT (this request only):\n` +
      `Review a long 5m liquidity sweep, reclaim and later retest inside a 1h range. ` +
      `The strategy is mean reversion. Its required RR is ${context.minRr}; ` +
      `this specific RR replaces the general trend RR rule above for this candidate only. ` +
      `Review the exact entry, SL and TP provided in RANGE RETEST LEVELS. ` +
      `Confirm buy only if these levels and the observed structure support the trade. ` +
      `If SL is inside invalidation liquidity, TP is unsupported, or evidence is weak, return hold. ` +
      `Do not invent a breakout or extend TP to meet the trend RR. ` +
      `HOLD remains a valid veto; all confidence and direction rules still apply.`,
    userContext:
      `\n\nRANGE SWEEP / RECLAIM / RETEST:\n` +
      `Candidate: ${context.candidateKey}\n` +
      `Allowed side: long\nReclaimed boundary: ${context.boundaryPrice}\n` +
      (Number.isFinite(context.rangeLow) && Number.isFinite(context.rangeHigh)
        ? `Observed range: ${context.rangeLow} to ${context.rangeHigh}\n` : '') +
      `A later closed candle retested and held this boundary. Assess mean-reversion quality.\n` +
      `RANGE RETEST LEVELS: entry=${context.confirmedEntryPrice}, ` +
      `SL=${stopLoss}, TP=${takeProfit}, RR=${context.minRr}.\n` +
      `Execution uses these exact strategy levels if approved. HOLD if the plan is invalid.`,
  };
}

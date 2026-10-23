import type { ObservationBar } from './post-exit-analysis';
import type { FundingObservation } from './range-mirror-observation';

export interface LlmShadowPlan {
  eventId: number;
  model: string;
  symbol: string;
  timeframe: string;
  action: 'buy' | 'sell';
  confidence: number;
  entry: number;
  stop: number;
  target: number;
  availableAt: number;
  ttlMs: number;
  maxHoldMs: number;
}

export type LlmShadowOutcome = {
  version: 'llm-shadow-outcome-v1';
  eventId: number;
  model: string;
  side: 'long' | 'short';
  status: 'incomplete' | 'pending_entry' | 'expired_without_fill' | 'open' | 'resolved';
  reason: 'minute_gap' | 'pending' | 'expired' | 'stop_loss' | 'take_profit' | 'time_exit';
  fillTime: number | null;
  exitTime: number | null;
  exitPrice: number | null;
  entryMinuteAmbiguous: boolean;
  exitMinuteAmbiguous: boolean;
  quantity: number;
  grossR: number | null;
  baseNetR: number | null;
  stressNetR: number | null;
  baseNetUsd: number | null;
  stressNetUsd: number | null;
  feeUsd: number | null;
  fundingUsd: number | null;
  promotionEligible: boolean;
};

const MINUTE_MS = 60_000;

function continuous(bars: ObservationBar[], start: number, end: number): boolean {
  const expected = Math.max(0, (end - start) / MINUTE_MS);
  return bars.length === expected
    && bars.every((bar, index) => bar.openTime === start + index * MINUTE_MS);
}

function baseResult(plan: LlmShadowPlan): LlmShadowOutcome {
  return {
    version: 'llm-shadow-outcome-v1',
    eventId: plan.eventId,
    model: plan.model,
    side: plan.action === 'buy' ? 'long' : 'short',
    status: 'pending_entry',
    reason: 'pending',
    fillTime: null,
    exitTime: null,
    exitPrice: null,
    entryMinuteAmbiguous: false,
    exitMinuteAmbiguous: false,
    quantity: 0.001,
    grossR: null,
    baseNetR: null,
    stressNetR: null,
    baseNetUsd: null,
    stressNetUsd: null,
    feeUsd: null,
    fundingUsd: null,
    promotionEligible: false,
  };
}

/** Conservative minute-bar limit fill and fixed SL/TP outcome after costs. */
export function resolveLlmShadowOutcome(input: {
  plan: LlmShadowPlan;
  bars: ObservationBar[];
  funding: FundingObservation[];
  asOf: number;
}): LlmShadowOutcome {
  const { plan, funding, asOf } = input;
  const result = baseResult(plan);
  const direction = plan.action === 'buy' ? 1 : -1;
  const validGeometry = direction * (plan.entry - plan.stop) > 0
    && direction * (plan.target - plan.entry) > 0;
  if (!validGeometry || ![
    plan.entry, plan.stop, plan.target, plan.availableAt, plan.ttlMs, plan.maxHoldMs, asOf,
  ].every((value) => Number.isFinite(value) && value > 0)) {
    return { ...result, status: 'incomplete', reason: 'minute_gap' };
  }

  const start = Math.ceil(plan.availableAt / MINUTE_MS) * MINUTE_MS;
  const availableEnd = Math.floor(asOf / MINUTE_MS) * MINUTE_MS;
  const expiry = start + plan.ttlMs;
  const entryEnd = Math.min(availableEnd, expiry);
  const entryBars = input.bars.filter((bar) => bar.openTime >= start && bar.openTime < entryEnd);
  if (!continuous(entryBars, start, entryEnd)) {
    return { ...result, status: 'incomplete', reason: 'minute_gap' };
  }

  const fillBar = entryBars.find((bar) => bar.low <= plan.entry && bar.high >= plan.entry);
  if (!fillBar) {
    if (availableEnd >= expiry) {
      return { ...result, status: 'expired_without_fill', reason: 'expired' };
    }
    return result;
  }

  result.fillTime = fillBar.openTime;
  const fillStopHit = direction === 1 ? fillBar.low <= plan.stop : fillBar.high >= plan.stop;
  const fillTargetHit = direction === 1 ? fillBar.high >= plan.target : fillBar.low <= plan.target;
  if (fillStopHit || fillTargetHit) result.entryMinuteAmbiguous = true;

  const deadline = fillBar.openTime + plan.maxHoldMs;
  const outcomeEnd = Math.min(availableEnd, deadline);
  const outcomeStart = fillBar.openTime + MINUTE_MS;
  const outcomeBars = input.bars.filter(
    (bar) => bar.openTime >= outcomeStart && bar.openTime < outcomeEnd
  );
  if (!continuous(outcomeBars, outcomeStart, outcomeEnd)) {
    return { ...result, status: 'incomplete', reason: 'minute_gap' };
  }

  let exitPrice: number | null = null;
  let exitTime: number | null = null;
  let reason: LlmShadowOutcome['reason'] = 'pending';
  let exitMinuteAmbiguous = false;
  for (const bar of outcomeBars) {
    const stopHit = direction === 1 ? bar.low <= plan.stop : bar.high >= plan.stop;
    const targetHit = direction === 1 ? bar.high >= plan.target : bar.low <= plan.target;
    if (!stopHit && !targetHit) continue;
    exitMinuteAmbiguous = stopHit && targetHit;
    reason = stopHit ? 'stop_loss' : 'take_profit';
    exitPrice = stopHit
      ? direction === 1 ? Math.min(bar.open, plan.stop) : Math.max(bar.open, plan.stop)
      : plan.target;
    exitTime = bar.openTime;
    break;
  }

  if (exitPrice === null && availableEnd >= deadline) {
    const last = outcomeBars.at(-1);
    if (!last) return { ...result, status: 'incomplete', reason: 'minute_gap' };
    exitPrice = last.close;
    exitTime = deadline;
    reason = 'time_exit';
  }
  if (exitPrice === null || exitTime === null) {
    return { ...result, status: 'open', reason: 'pending' };
  }

  const quantity = result.quantity;
  const riskUsd = Math.abs(plan.entry - plan.stop) * quantity;
  const grossUsd = direction * (exitPrice - plan.entry) * quantity;
  const feeUsd = (plan.entry + exitPrice) * quantity * 0.0005;
  const fundingUsd = funding.reduce((sum, item) => {
    const fundingTime = Number(item.fundingTime);
    const cash = -direction * quantity * Number(item.markPrice) * Number(item.fundingRate);
    return fundingTime > fillBar.openTime && fundingTime < exitTime ? sum + cash : sum;
  }, 0);
  const baseNetUsd = grossUsd - feeUsd - plan.entry * quantity * 0.001 + fundingUsd;
  const stressNetUsd = grossUsd - feeUsd - plan.entry * quantity * 0.002 + fundingUsd;

  return {
    ...result,
    status: 'resolved',
    reason,
    exitTime,
    exitPrice,
    exitMinuteAmbiguous,
    grossR: riskUsd > 0 ? grossUsd / riskUsd : null,
    baseNetR: riskUsd > 0 ? baseNetUsd / riskUsd : null,
    stressNetR: riskUsd > 0 ? stressNetUsd / riskUsd : null,
    baseNetUsd,
    stressNetUsd,
    feeUsd,
    fundingUsd,
    promotionEligible: !result.entryMinuteAmbiguous,
  };
}

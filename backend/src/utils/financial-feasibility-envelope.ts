import { computeExecutionRisk, resolveExecutionRiskCapUsd } from './execution-risk';
import { resolveQuantityForMinNotional } from './order-quantity';

export interface EnvelopeInput {
  entry: number; balance: number; minSlFraction: number;
  feePercent: number; slippagePercent: number; maxRiskPercent: number;
  maxRiskUsd: number | null; exposureUsd: number; remainingDailyRiskUsd: number | null;
  filters: { minQty: number; maxQty: number; stepSize: number; minNotional: number; tickSize: number };
}

/** Observation only. Reuses production quantity/risk math; never authorizes an order. */
export function financialFeasibilityEnvelope(input: EnvelopeInput) {
  const { entry, balance, filters, minSlFraction, feePercent, slippagePercent } = input;
  if (![entry,balance,filters.minQty,filters.maxQty,filters.stepSize,filters.minNotional,filters.tickSize,minSlFraction]
    .every(n => Number.isFinite(n) && n > 0) || minSlFraction >= 1 || filters.maxQty < filters.minQty ||
    ![feePercent,slippagePercent,input.exposureUsd,input.maxRiskPercent].every(n => Number.isFinite(n) && n >= 0) ||
    (input.maxRiskUsd !== null && (!Number.isFinite(input.maxRiskUsd) || input.maxRiskUsd <= 0)) ||
    (input.remainingDailyRiskUsd !== null && (!Number.isFinite(input.remainingDailyRiskUsd) || input.remainingDailyRiskUsd < 0))) {
    throw new Error('invalid_envelope_input');
  }
  const quantity = resolveQuantityForMinNotional({ quantity: 0, entryPrice: entry, minNotionalUsd: filters.minNotional,
    minQty: filters.minQty, stepSize: filters.stepSize, tolerancePercent: 0 });
  const q = quantity.normalizedQty;
  const cap = resolveExecutionRiskCapUsd({ balance, maxRiskPercent: input.maxRiskPercent, maxRiskUsd: input.maxRiskUsd });
  const budget = Math.min(cap, input.remainingDailyRiskUsd ?? cap);
  const f = feePercent / 100, slip = slippagePercent / 100, tick = filters.tickSize;
  const down = (n: number) => Number((Math.floor(n / tick + 1e-9) * tick).toPrecision(15));
  const up = (n: number) => Number((Math.ceil(n / tick - 1e-9) * tick).toPrecision(15));
  return {
    role: 'minimum_lot_envelope_not_admission', quantity: q, notional: entry * q, riskCapUsd: cap,
    effectiveBudgetUsd: budget, dailyBudgetKnown: input.remainingDailyRiskUsd !== null,
    sides: (['long','short'] as const).map(side => {
      const isLong = side === 'long';
      const stopAtFloor = isLong ? down(entry * (1 - minSlFraction)) : up(entry * (1 + minSlFraction));
      if (!(stopAtFloor > 0)) throw new Error('invalid_tick_geometry');
      const risk = computeExecutionRisk({ entry, stopLoss: stopAtFloor, quantity: q, balance,
        roundTripFeePercent: feePercent, slippagePercent });
      // Short fee reserve uses the higher stop leg. Long reserve uses entry.
      const maxDistance = isLong ? budget / q - entry * (f + slip) : (budget / q - entry * (f + slip)) / (1 + f);
      const widestStop = isLong ? up(Math.max(tick,entry - maxDistance)) : down(entry + maxDistance);
      const blockers: string[] = [];
      if (!quantity.valid || q > filters.maxQty) blockers.push('quantity');
      if (entry * q > input.exposureUsd + 1e-9) blockers.push('exposure');
      if (risk.totalRiskUsd > cap + 1e-9) blockers.push('trade_risk');
      if (input.remainingDailyRiskUsd !== null && risk.totalRiskUsd > input.remainingDailyRiskUsd + 1e-9) blockers.push('daily_budget');
      return { side, stopAtFloor, floorRisk: risk, blockers, financiallyFeasibleAtFloor: blockers.length === 0,
        maxStopFraction: Math.max(0, maxDistance / entry),
        widestStopWithinBudget: blockers.length ? null : widestStop };
    }),
  };
}

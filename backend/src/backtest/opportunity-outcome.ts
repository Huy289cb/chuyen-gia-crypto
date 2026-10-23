import type { OpportunityCandle, OpportunityPlan } from '../utils/ai-opportunity';
import type { ReplayFunding } from './replay-account';

export interface OpportunityOutcomeOptions {
  submittedAt: number;
  entryExpiresAt: number;
  horizonAt: number;
  barMs: number;
  feePerSide: number;
  slippageFraction: number;
  funding: ReplayFunding[];
  pendingReview?: { cadenceMs: number; maxDriftFraction: number };
}
export interface OpportunityOutcome {
  planId: string;
  status: 'unfilled' | 'censored' | 'closed';
  reason: string;
  entryTime: number | null;
  exitTime: number | null;
  exitPrice: number | null;
  grossUsd: number | null;
  feesUsd: number | null;
  slippageUsd: number | null;
  fundingUsd: number | null;
  netUsd: number | null;
  ambiguous: boolean;
}

/** Independent counterfactual for EVERY plan, not a portfolio or live execution claim.
 * Ignore partial submission bars; limit touch fills at limit (no favorable improvement).
 * Same-bar stop wins. Intrabar entry cannot earn same-bar TP without known ordering.
 * Missing future data is censored, never converted to a profitable close.
 */
export function evaluateOpportunityOutcome(plan: OpportunityPlan, bars: OpportunityCandle[], o: OpportunityOutcomeOptions): OpportunityOutcome {
  const dir = plan.side === 'long' ? 1 : -1;
  if (plan.symbol !== 'BTC' || plan.timeframe !== '15m' || !['long','short'].includes(plan.side) ||
      ![plan.entry, plan.stopLoss, plan.takeProfit, plan.quantity, o.barMs].every(v => Number.isFinite(v) && v > 0) ||
      ![o.submittedAt, o.entryExpiresAt, o.horizonAt, o.feePerSide, o.slippageFraction].every(Number.isFinite) ||
      o.entryExpiresAt <= o.submittedAt || o.horizonAt < o.entryExpiresAt || o.feePerSide < 0 || o.slippageFraction < 0 ||
      dir * (plan.entry - plan.stopLoss) <= 0 || dir * (plan.takeProfit - plan.entry) <= 0) throw new Error('invalid_outcome_contract');
  if (o.pendingReview && (!Number.isFinite(o.pendingReview.cadenceMs) || o.pendingReview.cadenceMs < o.barMs ||
    o.pendingReview.cadenceMs % o.barMs !== 0 || !Number.isFinite(o.pendingReview.maxDriftFraction) ||
    o.pendingReview.maxDriftFraction <= 0)) throw new Error('invalid_pending_review');
  for (let i = 0; i < o.funding.length; i++) {
    const f = o.funding[i];
    if (![f.time, f.rate, f.markPrice].every(Number.isFinite) || f.markPrice <= 0 ||
      (i > 0 && f.time <= o.funding[i - 1].time)) throw new Error('invalid_funding');
  }
  for (let i = 0; i < bars.length; i++) {
    if (!Number.isInteger(bars[i].timestamp) || bars[i].timestamp % o.barMs !== 0 ||
      (i > 0 && bars[i].timestamp <= bars[i - 1].timestamp)) throw new Error('invalid_bar_order');
  }
  const result: OpportunityOutcome = { planId: plan.id, status: 'censored', reason: 'insufficient_future',
    entryTime: null, exitTime: null, exitPrice: null, grossUsd: null, feesUsd: null, slippageUsd: null,
    fundingUsd: null, netUsd: null, ambiguous: false };
  let expected = Math.ceil(o.submittedAt / o.barMs) * o.barMs;
  const close = (price: number, time: number, reason: string) => {
    const grossUsd = dir * (price - plan.entry) * plan.quantity;
    const feesUsd = (plan.entry + price) * plan.quantity * o.feePerSide;
    const slippageUsd = plan.entry * plan.quantity * o.slippageFraction;
    const fundingUsd = o.funding.filter(f => f.time > result.entryTime! && f.time <= time)
      .reduce((sum, f) => sum + dir * plan.quantity * f.markPrice * f.rate, 0);
    return { ...result, status: 'closed' as const, reason, exitTime: time, exitPrice: price,
      grossUsd, feesUsd, slippageUsd, fundingUsd, netUsd: grossUsd - feesUsd - slippageUsd - fundingUsd };
  };
  for (const b of bars) {
    if (b.timestamp < expected) continue;
    if (b.timestamp !== expected) return { ...result, reason: 'data_gap' };
    if (![b.open, b.high, b.low, b.close].every(v => Number.isFinite(v) && v > 0) ||
      b.low > Math.min(b.open, b.close) || b.high < Math.max(b.open, b.close)) throw new Error('invalid_ohlc');
    const end = b.timestamp + o.barMs;
    if (end > o.horizonAt) break;
    expected = end;
    let intrabarEntry = false;
    if (result.entryTime === null) {
      if (b.timestamp >= o.entryExpiresAt) return { ...result, status: 'unfilled', reason: 'entry_expired' };
      if (o.pendingReview && b.timestamp % o.pendingReview.cadenceMs === 0 &&
        Math.abs(b.open - plan.entry) / plan.entry >= o.pendingReview.maxDriftFraction) {
        return { ...result, status: 'unfilled', reason: 'pending_drift_cancel' };
      }
      // A partially observable expiry bar cannot establish a fill before expiry.
      if (end > o.entryExpiresAt) return { ...result, reason: 'partial_expiry_bar' };
      const marketable = dir * (b.open - plan.entry) <= 0;
      const touched = dir === 1 ? b.low <= plan.entry : b.high >= plan.entry;
      if (!marketable && !touched) continue;
      intrabarEntry = !marketable;
      result.entryTime = b.timestamp;
    }
    const stop = dir === 1 ? b.low <= plan.stopLoss : b.high >= plan.stopLoss;
    const target = dir === 1 ? b.high >= plan.takeProfit : b.low <= plan.takeProfit;
    if (dir * (b.open - plan.stopLoss) <= 0) return close(b.open, b.timestamp, 'gap_stop');
    if (!intrabarEntry && dir * (b.open - plan.takeProfit) >= 0) return close(plan.takeProfit, b.timestamp, 'gap_target');
    if (stop) { result.ambiguous ||= target || intrabarEntry; return close(plan.stopLoss, end, result.ambiguous ? 'ambiguous_stop_first' : 'stop'); }
    if (target && !intrabarEntry) return close(plan.takeProfit, end, 'target');
    if (target && intrabarEntry) result.ambiguous = true;
    if (end === o.horizonAt) return close(b.close, end, 'time_exit');
  }
  if (result.entryTime === null && expected >= o.entryExpiresAt) return { ...result, status: 'unfilled', reason: 'entry_expired' };
  return result;
}

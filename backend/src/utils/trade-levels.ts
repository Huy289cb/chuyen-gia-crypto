import type { GroqAnalysis } from '../services/groq-client';

/**
 * Risk:reward from entry / stop / target prices (reward ÷ risk).
 */
export function computeExpectedRrFromPrices(
  entry: number,
  stopLoss: number,
  takeProfit: number
): number | null {
  if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || !Number.isFinite(takeProfit)) {
    return null;
  }
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);
  if (risk <= 0) return null;
  return reward / risk;
}

export interface RrReconcileResult {
  analysis: GroqAnalysis;
  computedRr: number | null;
  llmClaimedRr: number | null;
  rrCorrected: boolean;
}

/**
 * Overwrite expected_rr with price-derived R:R; warn when LLM claim diverges.
 */
export function formatPriceLevel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/** One-line summary for event log / trade_decisions */
export function formatLlmTradeSummary(analysis: {
  action?: string;
  confidence?: number;
  suggested_entry?: number;
  suggested_stop_loss?: number;
  suggested_take_profit?: number;
}): string {
  const action = String(analysis.action ?? '—');
  const conf =
    analysis.confidence != null && Number.isFinite(analysis.confidence)
      ? `${(analysis.confidence * 100).toFixed(0)}%`
      : '—';
  return [
    `LLM: ${action}`,
    `conf ${conf}`,
    `entry ${formatPriceLevel(analysis.suggested_entry)}`,
    `SL ${formatPriceLevel(analysis.suggested_stop_loss)}`,
    `TP ${formatPriceLevel(analysis.suggested_take_profit)}`,
  ].join(' · ');
}

/**
 * Minimum-distance SL + TP at min R:R from entry (policy math — does not rely on LLM arithmetic).
 */
export function computePolicyCompliantStopAndTarget(input: {
  action: 'buy' | 'sell';
  entry: number;
  minSlPct: number;
  minRr: number;
}): { stopLoss: number; takeProfit: number } | null {
  const { action, entry, minSlPct, minRr } = input;
  if (!Number.isFinite(entry) || entry <= 0 || minSlPct <= 0 || minRr <= 0) return null;

  if (action === 'buy') {
    const stopLoss = Math.floor(entry * (1 - minSlPct) * 100) / 100;
    const risk = entry - stopLoss;
    if (risk <= 0) return null;
    const takeProfit = Math.round((entry + risk * minRr) * 100) / 100;
    if (takeProfit <= entry) return null;
    return { stopLoss, takeProfit };
  }

  const stopLoss = Math.ceil(entry * (1 + minSlPct) * 100) / 100;
  const risk = stopLoss - entry;
  if (risk <= 0) return null;
  const takeProfit = Math.round((entry - risk * minRr) * 100) / 100;
  if (takeProfit >= entry) return null;
  return { stopLoss, takeProfit };
}

/** Minimum TP price for a fixed entry/SL to satisfy min R:R (reward/risk). */
export function computeMinTakeProfitForRr(input: {
  action: 'buy' | 'sell';
  entry: number;
  stopLoss: number;
  minRr: number;
}): number | null {
  const { action, entry, stopLoss, minRr } = input;
  const risk = Math.abs(entry - stopLoss);
  if (!Number.isFinite(entry) || risk <= 0 || minRr <= 0) return null;
  if (action === 'buy') {
    const tp = Math.round((entry + risk * minRr) * 100) / 100;
    return tp > entry ? tp : null;
  }
  const tp = Math.round((entry - risk * minRr) * 100) / 100;
  return tp < entry ? tp : null;
}

/** Cent-rounded prices + IEEE float can sit ~1 ULP below policy min (e.g. 0.80% → 0.799999…). */
export const MIN_SL_DISTANCE_EPS_RATIO = 1e-6;

export function checkMinSlDistance(
  entry: number,
  stopLoss: number,
  minPct: number
): { ok: boolean; distancePct: number; minPct: number } {
  const distancePct = Math.abs(entry - stopLoss) / entry;
  return {
    ok: distancePct >= minPct - MIN_SL_DISTANCE_EPS_RATIO,
    distancePct,
    minPct,
  };
}

export function reconcileExpectedRr(analysis: GroqAnalysis): RrReconcileResult {
  const entry = Number(analysis.suggested_entry);
  const sl = Number(analysis.suggested_stop_loss);
  const tp = Number(analysis.suggested_take_profit);

  const llmClaimedRr =
    analysis.expected_rr != null && Number.isFinite(Number(analysis.expected_rr))
      ? Number(analysis.expected_rr)
      : null;

  const computedRr = computeExpectedRrFromPrices(entry, sl, tp);

  if (computedRr == null) {
    return { analysis, computedRr: null, llmClaimedRr, rrCorrected: false };
  }

  const rounded = Math.round(computedRr * 100) / 100;
  let rrCorrected = false;

  if (llmClaimedRr == null || Math.abs(llmClaimedRr - rounded) > 0.15) {
    if (llmClaimedRr != null && llmClaimedRr > 0) {
      console.warn(
        `[TradeLevels] LLM expected_rr=${llmClaimedRr} corrected to ${rounded} ` +
          `(entry=${entry} sl=${sl} tp=${tp})`
      );
    }
    rrCorrected = llmClaimedRr != null && Math.abs(llmClaimedRr - rounded) > 0.15;
  }

  return {
    analysis: { ...analysis, expected_rr: rounded },
    computedRr: rounded,
    llmClaimedRr,
    rrCorrected,
  };
}

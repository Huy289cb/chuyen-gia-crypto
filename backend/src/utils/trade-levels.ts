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

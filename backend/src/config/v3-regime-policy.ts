/**
 * Regime classification thresholds + gate bypass rules (env-tunable).
 */

import type { MarketRegime } from '../analyzers/market-regime.analyzer';

function parsePct(value: string | undefined, fallback: number): number {
  const n = parseFloat(value ?? String(fallback));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Min linear trend strength (%) to classify as trend on each TF. */
export function getRegimeTrendMinPct(timeframe: string): number {
  switch (timeframe) {
    case '5m':
      return parsePct(process.env.V3_REGIME_TREND_MIN_5M, 0.1);
    case '15m':
      return parsePct(process.env.V3_REGIME_TREND_MIN_15M, 0.08);
    case '1h':
      return parsePct(process.env.V3_REGIME_TREND_MIN_1H, 0.06);
    case '4h':
      return parsePct(process.env.V3_REGIME_TREND_MIN_4H, 0.12);
    default:
      return parsePct(process.env.V3_REGIME_TREND_MIN_DEFAULT, 0.15);
  }
}

export function getRegimeStrongTrendMinPct(): number {
  return parsePct(process.env.V3_REGIME_STRONG_TREND_MIN, 0.25);
}

/**
 * Breakout with grade B+ counts as directional impulse — bypass range-only block on 15m/1h.
 * Keeps sweep setups requiring trend alignment unless HTF align applies.
 */
export function isBreakoutRegimeBypassEnabled(): boolean {
  if (process.env.V3_BREAKOUT_REGIME_BYPASS === 'false') {
    return false;
  }
  if (process.env.V3_BREAKOUT_REGIME_BYPASS === 'true') {
    return true;
  }
  // Default on when strict trend-only (fixes "price moved but slope says range")
  return (process.env.V3_ALLOWED_REGIMES?.trim() || 'trend') === 'trend';
}

const BREAKOUT_BYPASS_TFS = new Set(['5m', '15m', '1h']);

export function shouldBypassRegimeForBreakout(
  timeframe: string,
  playbookKey: string | null,
  grade: 'A' | 'B' | 'C' | 'D'
): boolean {
  if (!isBreakoutRegimeBypassEnabled() || !BREAKOUT_BYPASS_TFS.has(timeframe)) {
    return false;
  }
  if (playbookKey !== 'breakout_volume') {
    return false;
  }
  return grade === 'A' || grade === 'B';
}

export function regimeForGatePass(input: {
  timeframe: string;
  localRegime: MarketRegime;
  htfRegime?: MarketRegime | null;
  playbookKey: string | null;
  grade: 'A' | 'B' | 'C' | 'D';
  alignHtf?: (tf: string, local: MarketRegime, htf: MarketRegime | null | undefined) => MarketRegime;
}): MarketRegime {
  const { timeframe, localRegime, htfRegime, playbookKey, grade, alignHtf } = input;

  if (shouldBypassRegimeForBreakout(timeframe, playbookKey, grade)) {
    return 'trend';
  }

  if (alignHtf) {
    return alignHtf(timeframe, localRegime, htfRegime);
  }

  return localRegime;
}

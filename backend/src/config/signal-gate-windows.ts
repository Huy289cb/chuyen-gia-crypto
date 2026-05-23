/**
 * Per-timeframe lookback windows for setup gate (wall-clock aligned to ~15m baseline).
 * 5m uses more bars so sweep/regime see a similar time span as 15m/1h.
 */

export interface SignalGateWindows {
  /** Bars for regime regression (last N). */
  regimeBars: number;
  /** Prior bars before current for liquidity sweep (excludes current). */
  sweepPriorBars: number;
  /** Total bars for breakout (includes current). */
  breakoutBars: number;
  minCandles: number;
}

const WINDOWS_15M: SignalGateWindows = {
  regimeBars: 50,
  sweepPriorBars: 19,
  breakoutBars: 30,
  minCandles: 50,
};

/** ~6h regime, ~4h sweep, ~4h consolidation — within 120-bar fetch. */
const WINDOWS_5M: SignalGateWindows = {
  regimeBars: 72,
  sweepPriorBars: 48,
  breakoutBars: 48,
  minCandles: 50,
};

const WINDOWS_1H: SignalGateWindows = {
  regimeBars: 50,
  sweepPriorBars: 19,
  breakoutBars: 30,
  minCandles: 50,
};

export function getSignalGateWindows(timeframe: string): SignalGateWindows {
  switch (timeframe) {
    case '5m':
      return WINDOWS_5M;
    case '1h':
      return WINDOWS_1H;
    case '15m':
    default:
      return WINDOWS_15M;
  }
}

/** Candle fetch limit — 5m needs more history for scaled windows. */
export function getSignalGateCandleLimit(timeframe: string): number {
  const w = getSignalGateWindows(timeframe);
  return Math.max(100, w.regimeBars + 10, w.breakoutBars + 5);
}

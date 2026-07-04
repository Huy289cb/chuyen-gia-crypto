import type { SetupGateResult, CandleData } from '../analyzers/setup-gate.analyzer';
import { analyzeLiquiditySweep } from '../analyzers/liquidity-sweep.analyzer';
import { analyzeBreakoutVolume } from '../analyzers/breakout-volume.analyzer';
import { getSignalGateWindows } from '../config/signal-gate-windows';

export type TradeSide = 'long' | 'short';

/** Infer directional bias from playbook evidence (no LLM). */
export function inferSetupTradeSide(
  setup: SetupGateResult,
  timeframe: string,
  candles: CandleData[]
): TradeSide | null {
  if (setup.playbookKey === 'breakout_volume') {
    const windows = getSignalGateWindows(timeframe);
    const br = analyzeBreakoutVolume(candles, { windowBars: windows.breakoutBars });
    if (br.direction === 'bullish') return 'long';
    if (br.direction === 'bearish') return 'short';
  }

  if (setup.playbookKey === 'liquidity_sweep_reclaim') {
    const windows = getSignalGateWindows(timeframe);
    const sw = analyzeLiquiditySweep(candles, { priorBars: windows.sweepPriorBars });
    if (sw.sweepType === 'low') return 'long';
    if (sw.sweepType === 'high') return 'short';
  }

  const td = setup.evidence.regime.trendDirection;
  if (td === 'bullish') return 'long';
  if (td === 'bearish') return 'short';
  return null;
}

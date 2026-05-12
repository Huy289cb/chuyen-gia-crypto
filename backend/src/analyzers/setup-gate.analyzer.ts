/**
 * Setup Gate Analyzer
 * Combines all conditions to determine if a valid setup exists
 * Output: playbookKey, grade (A/B/C/D), confidence, regime
 */

import { analyzeLiquiditySweep } from './liquidity-sweep.analyzer';
import { analyzeBreakoutVolume } from './breakout-volume.analyzer';
import { analyzeMarketRegime } from './market-regime.analyzer';

export interface CandleData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface SetupGateResult {
  playbookKey: string | null;
  grade: 'A' | 'B' | 'C' | 'D';
  confidence: number;
  regime: 'trend' | 'range' | 'chop';
  reason: string;
}

export interface SetupGateInput {
  candles: CandleData[];
  symbol: string;
  timeframe: string;
}

/**
 * Analyze market data to determine if a valid setup exists
 */
export async function analyzeSetupGate(input: SetupGateInput): Promise<SetupGateResult> {
  const { candles } = input;

  if (candles.length < 50) {
    return {
      playbookKey: null,
      grade: 'D',
      confidence: 0,
      regime: 'chop',
      reason: 'Insufficient candle data (need at least 50 candles)'
    };
  }

  // Analyze market regime first
  const regime = analyzeMarketRegime(candles);

  // If regime is choppy, reject immediately
  if (regime === 'chop') {
    return {
      playbookKey: null,
      grade: 'D',
      confidence: 0,
      regime: 'chop',
      reason: 'Market regime is choppy - no trade'
    };
  }

  // Check for liquidity sweep setup
  const liquiditySweep = analyzeLiquiditySweep(candles);

  // Check for breakout + volume setup
  const breakoutVolume = analyzeBreakoutVolume(candles);

  // Determine best setup
  let bestSetup: SetupGateResult = {
    playbookKey: null,
    grade: 'D',
    confidence: 0,
    regime,
    reason: 'No valid setup detected'
  };

  if (liquiditySweep.detected && liquiditySweep.grade === 'A') {
    bestSetup = {
      playbookKey: 'liquidity_sweep_reclaim',
      grade: 'A',
      confidence: liquiditySweep.confidence,
      regime,
      reason: liquiditySweep.reason
    };
  }

  if (breakoutVolume.detected && breakoutVolume.grade === 'A') {
    // Prefer breakout if confidence is higher
    if (breakoutVolume.confidence > bestSetup.confidence) {
      bestSetup = {
        playbookKey: 'breakout_volume',
        grade: 'A',
        confidence: breakoutVolume.confidence,
        regime,
        reason: breakoutVolume.reason
      };
    }
  }

  // If no A-grade setup, check for B-grade
  if (bestSetup.grade === 'D') {
    if (liquiditySweep.detected && liquiditySweep.grade === 'B') {
      bestSetup = {
        playbookKey: 'liquidity_sweep_reclaim',
        grade: 'B',
        confidence: liquiditySweep.confidence,
        regime,
        reason: liquiditySweep.reason
      };
    }

    if (breakoutVolume.detected && breakoutVolume.grade === 'B') {
      if (breakoutVolume.confidence > bestSetup.confidence) {
        bestSetup = {
          playbookKey: 'breakout_volume',
          grade: 'B',
          confidence: breakoutVolume.confidence,
          regime,
          reason: breakoutVolume.reason
        };
      }
    }
  }

  return bestSetup;
}

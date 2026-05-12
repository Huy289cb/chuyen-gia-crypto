/**
 * Liquidity Sweep Analyzer
 * Detects:
 * - Sweep high + rejection
 * - Sweep low + reclaim
 */

import { CandleData } from './setup-gate.analyzer';

export interface LiquiditySweepResult {
  detected: boolean;
  grade: 'A' | 'B' | 'C' | 'D';
  confidence: number;
  reason: string;
  sweepType: 'high' | 'low' | null;
}

/**
 * Analyze candles for liquidity sweep patterns
 */
export function analyzeLiquiditySweep(candles: CandleData[]): LiquiditySweepResult {
  if (candles.length < 20) {
    return {
      detected: false,
      grade: 'D',
      confidence: 0,
      reason: 'Insufficient data for liquidity sweep analysis',
      sweepType: null
    };
  }

  const recentCandles = candles.slice(-20);
  const currentCandle = recentCandles[recentCandles.length - 1];

  // Calculate recent high/low range
  const recentHighs = recentCandles.slice(0, -1).map(c => c.high);
  const recentLows = recentCandles.slice(0, -1).map(c => c.low);
  const highestHigh = Math.max(...recentHighs);
  const lowestLow = Math.min(...recentLows);

  // Check for high sweep + rejection
  const highSweep = currentCandle.high > highestHigh && currentCandle.close < currentCandle.open;
  // Check for low sweep + reclaim
  const lowSweep = currentCandle.low < lowestLow && currentCandle.close > currentCandle.open;

  let result: LiquiditySweepResult = {
    detected: false,
    grade: 'D',
    confidence: 0,
    reason: 'No liquidity sweep detected',
    sweepType: null
  };

  if (highSweep) {
    const wickRatio = (currentCandle.high - Math.max(currentCandle.open, currentCandle.close)) / (currentCandle.high - currentCandle.low);
    const bodyRatio = Math.abs(currentCandle.close - currentCandle.open) / (currentCandle.high - currentCandle.low);

    // Grade based on wick and body characteristics
    if (wickRatio > 0.6 && bodyRatio > 0.2) {
      result = {
        detected: true,
        grade: 'A',
        confidence: 0.85,
        reason: 'Strong high sweep with long wick rejection and solid body',
        sweepType: 'high'
      };
    } else if (wickRatio > 0.5 && bodyRatio > 0.15) {
      result = {
        detected: true,
        grade: 'B',
        confidence: 0.70,
        reason: 'Moderate high sweep with rejection',
        sweepType: 'high'
      };
    } else {
      result = {
        detected: true,
        grade: 'C',
        confidence: 0.55,
        reason: 'Weak high sweep pattern',
        sweepType: 'high'
      };
    }
  }

  if (lowSweep) {
    const wickRatio = (Math.min(currentCandle.open, currentCandle.close) - currentCandle.low) / (currentCandle.high - currentCandle.low);
    const bodyRatio = Math.abs(currentCandle.close - currentCandle.open) / (currentCandle.high - currentCandle.low);

    // Grade based on wick and body characteristics
    if (wickRatio > 0.6 && bodyRatio > 0.2) {
      result = {
        detected: true,
        grade: 'A',
        confidence: 0.85,
        reason: 'Strong low sweep with long wick rejection and solid body',
        sweepType: 'low'
      };
    } else if (wickRatio > 0.5 && bodyRatio > 0.15) {
      result = {
        detected: true,
        grade: 'B',
        confidence: 0.70,
        reason: 'Moderate low sweep with rejection',
        sweepType: 'low'
      };
    } else {
      result = {
        detected: true,
        grade: 'C',
        confidence: 0.55,
        reason: 'Weak low sweep pattern',
        sweepType: 'low'
      };
    }
  }

  return result;
}

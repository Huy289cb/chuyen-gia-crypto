/**
 * Breakout + Volume Analyzer
 * Detects breakout with volume confirmation
 */

import { CandleData } from './setup-gate.analyzer';

export interface BreakoutVolumeResult {
  detected: boolean;
  grade: 'A' | 'B' | 'C' | 'D';
  confidence: number;
  reason: string;
  direction: 'bullish' | 'bearish' | null;
}

/**
 * Analyze candles for breakout + volume patterns
 */
export function analyzeBreakoutVolume(candles: CandleData[]): BreakoutVolumeResult {
  if (candles.length < 30) {
    return {
      detected: false,
      grade: 'D',
      confidence: 0,
      reason: 'Insufficient data for breakout analysis',
      direction: null
    };
  }

  const recentCandles = candles.slice(-30);
  const currentCandle = recentCandles[recentCandles.length - 1];

  // Calculate range for consolidation detection
  const consolidationCandles = recentCandles.slice(0, -5);
  const highs = consolidationCandles.map(c => c.high);
  const lows = consolidationCandles.map(c => c.low);
  const resistance = Math.max(...highs);
  const support = Math.min(...lows);
  const range = resistance - support;

  // Calculate average volume
  const volumes = consolidationCandles.map(c => c.volume);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

  let result: BreakoutVolumeResult = {
    detected: false,
    grade: 'D',
    confidence: 0,
    reason: 'No breakout detected',
    direction: null
  };

  // Check for bullish breakout
  if (currentCandle.close > resistance && currentCandle.volume > avgVolume * 1.5) {
    const breakoutStrength = (currentCandle.close - resistance) / range;
    const volumeRatio = currentCandle.volume / avgVolume;

    if (breakoutStrength > 0.01 && volumeRatio > 2.0) {
      result = {
        detected: true,
        grade: 'A',
        confidence: 0.85,
        reason: `Strong bullish breakout with ${volumeRatio.toFixed(1)}x volume confirmation`,
        direction: 'bullish'
      };
    } else if (breakoutStrength > 0.005 && volumeRatio > 1.5) {
      result = {
        detected: true,
        grade: 'B',
        confidence: 0.70,
        reason: `Moderate bullish breakout with ${volumeRatio.toFixed(1)}x volume`,
        direction: 'bullish'
      };
    } else {
      result = {
        detected: true,
        grade: 'C',
        confidence: 0.55,
        reason: `Weak bullish breakout with ${volumeRatio.toFixed(1)}x volume`,
        direction: 'bullish'
      };
    }
  }

  // Check for bearish breakout
  if (currentCandle.close < support && currentCandle.volume > avgVolume * 1.5) {
    const breakoutStrength = (support - currentCandle.close) / range;
    const volumeRatio = currentCandle.volume / avgVolume;

    if (breakoutStrength > 0.01 && volumeRatio > 2.0) {
      result = {
        detected: true,
        grade: 'A',
        confidence: 0.85,
        reason: `Strong bearish breakout with ${volumeRatio.toFixed(1)}x volume confirmation`,
        direction: 'bearish'
      };
    } else if (breakoutStrength > 0.005 && volumeRatio > 1.5) {
      result = {
        detected: true,
        grade: 'B',
        confidence: 0.70,
        reason: `Moderate bearish breakout with ${volumeRatio.toFixed(1)}x volume`,
        direction: 'bearish'
      };
    } else {
      result = {
        detected: true,
        grade: 'C',
        confidence: 0.55,
        reason: `Weak bearish breakout with ${volumeRatio.toFixed(1)}x volume`,
        direction: 'bearish'
      };
    }
  }

  return result;
}

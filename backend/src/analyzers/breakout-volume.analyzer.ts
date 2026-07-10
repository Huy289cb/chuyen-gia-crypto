/**
 * Breakout + Volume Analyzer
 */

import { CandleData } from './setup-gate.analyzer';
import type { PlaybookEvidence } from './setup-gate.types';

export interface BreakoutVolumeResult {
  detected: boolean;
  grade: 'A' | 'B' | 'C' | 'D';
  confidence: number;
  reason: string;
  direction: 'bullish' | 'bearish' | null;
  evidence: PlaybookEvidence;
}

function fmt(n: number, d = 2): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: d });
}

export interface BreakoutVolumeOptions {
  windowBars?: number;
}

export function analyzeBreakoutVolume(
  candles: CandleData[],
  options?: BreakoutVolumeOptions
): BreakoutVolumeResult {
  const windowBars = options?.windowBars ?? 30;

  if (candles.length < windowBars) {
    return {
      detected: false,
      grade: 'D',
      confidence: 0,
      reason: 'Insufficient data for breakout analysis',
      direction: null,
      evidence: {
        playbook: 'breakout_volume',
        detected: false,
        grade: 'D',
        summary: `Thiếu dữ liệu (${candles.length}/${windowBars} nến)`,
        metrics: { windowCandles: windowBars },
      },
    };
  }

  const recentCandles = candles.slice(-windowBars);
  const currentCandle = recentCandles[recentCandles.length - 1];
  const consolidationCandles = recentCandles.slice(0, -5);
  const highs = consolidationCandles.map((c) => c.high);
  const lows = consolidationCandles.map((c) => c.low);
  const resistance = Math.max(...highs);
  const support = Math.min(...lows);
  const range = resistance - support;
  const volumes = consolidationCandles.map((c) => c.volume);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const volumeRatio = avgVolume > 0 ? currentCandle.volume / avgVolume : 0;
  const minVolRatio = 1.5;

  const metrics: PlaybookEvidence['metrics'] = {
    windowCandles: windowBars,
    consolidationBars: consolidationCandles.length,
    resistance,
    support,
    rangeWidth: range,
    lastClose: currentCandle.close,
    lastVolume: currentCandle.volume,
    avgVolume25: avgVolume,
    volumeRatio: Number(volumeRatio.toFixed(2)),
    minVolumeRatio: minVolRatio,
    bullishBreak: currentCandle.close > resistance,
    bearishBreak: currentCandle.close < support,
  };

  let result: BreakoutVolumeResult = {
    detected: false,
    grade: 'D',
    confidence: 0,
    reason: 'No breakout detected',
    direction: null,
    evidence: {
      playbook: 'breakout_volume',
      detected: false,
      grade: 'D',
      summary: '',
      metrics,
    },
  };

  const failReasons: string[] = [];
  if (currentCandle.close <= resistance && currentCandle.close >= support) {
    failReasons.push(
      `Close ${fmt(currentCandle.close)} trong vùng tích lũy ${fmt(support)}–${fmt(resistance)}`
    );
  } else if (currentCandle.close > resistance && volumeRatio < minVolRatio) {
    failReasons.push(
      `Close trên kháng cự ${fmt(resistance)} nhưng vol ${volumeRatio.toFixed(2)}x < ${minVolRatio}x`
    );
  } else if (currentCandle.close < support && volumeRatio < minVolRatio) {
    failReasons.push(
      `Close dưới hỗ trợ ${fmt(support)} nhưng vol ${volumeRatio.toFixed(2)}x < ${minVolRatio}x`
    );
  } else if (currentCandle.close > resistance) {
    failReasons.push(`Break up nhưng biên breakout/vùng < ngưỡng grade B`);
  } else if (currentCandle.close < support) {
    failReasons.push(`Break down nhưng biên breakout/vùng < ngưỡng grade B`);
  }

  if (currentCandle.close > resistance && currentCandle.volume > avgVolume * minVolRatio) {
    const breakoutStrength = range > 0 ? (currentCandle.close - resistance) / range : 0;
    if (breakoutStrength > 0.01 && volumeRatio > 2.0) {
      result = {
        detected: true,
        grade: 'A',
        confidence: 0.85,
        reason: `Strong bullish breakout with ${volumeRatio.toFixed(1)}x volume confirmation`,
        direction: 'bullish',
        evidence: {
          playbook: 'breakout_volume',
          detected: true,
          grade: 'A',
          summary: `Break up: close ${fmt(currentCandle.close)} > KC ${fmt(resistance)}, vol ${volumeRatio.toFixed(2)}x`,
          metrics: { ...metrics, breakoutStrengthPct: Number((breakoutStrength * 100).toFixed(2)) },
        },
      };
    } else if (breakoutStrength > 0.005 && volumeRatio > minVolRatio) {
      result = {
        detected: true,
        grade: 'B',
        confidence: 0.7,
        reason: `Moderate bullish breakout with ${volumeRatio.toFixed(1)}x volume`,
        direction: 'bullish',
        evidence: {
          playbook: 'breakout_volume',
          detected: true,
          grade: 'B',
          summary: `Break up vừa: +${(breakoutStrength * 100).toFixed(2)}% vùng, vol ${volumeRatio.toFixed(2)}x`,
          metrics: { ...metrics, breakoutStrengthPct: Number((breakoutStrength * 100).toFixed(2)) },
        },
      };
    } else {
      result = {
        detected: true,
        grade: 'C',
        confidence: 0.55,
        reason: `Weak bullish breakout with ${volumeRatio.toFixed(1)}x volume`,
        direction: 'bullish',
        evidence: {
          playbook: 'breakout_volume',
          detected: true,
          grade: 'C',
          summary: `Break up yếu (grade C)`,
          metrics,
        },
      };
    }
    return result;
  }

  if (currentCandle.close < support && currentCandle.volume > avgVolume * minVolRatio) {
    const breakoutStrength = range > 0 ? (support - currentCandle.close) / range : 0;
    if (breakoutStrength > 0.01 && volumeRatio > 2.0) {
      result = {
        detected: true,
        grade: 'A',
        confidence: 0.85,
        reason: `Strong bearish breakout with ${volumeRatio.toFixed(1)}x volume confirmation`,
        direction: 'bearish',
        evidence: {
          playbook: 'breakout_volume',
          detected: true,
          grade: 'A',
          summary: `Break down: close ${fmt(currentCandle.close)} < HT ${fmt(support)}, vol ${volumeRatio.toFixed(2)}x`,
          metrics: { ...metrics, breakoutStrengthPct: Number((breakoutStrength * 100).toFixed(2)) },
        },
      };
    } else if (breakoutStrength > 0.005 && volumeRatio > minVolRatio) {
      result = {
        detected: true,
        grade: 'B',
        confidence: 0.7,
        reason: `Moderate bearish breakout with ${volumeRatio.toFixed(1)}x volume`,
        direction: 'bearish',
        evidence: {
          playbook: 'breakout_volume',
          detected: true,
          grade: 'B',
          summary: `Break down vừa: vol ${volumeRatio.toFixed(2)}x`,
          metrics: { ...metrics, breakoutStrengthPct: Number((breakoutStrength * 100).toFixed(2)) },
        },
      };
    } else {
      result = {
        detected: true,
        grade: 'C',
        confidence: 0.55,
        reason: `Weak bearish breakout with ${volumeRatio.toFixed(1)}x volume`,
        direction: 'bearish',
        evidence: {
          playbook: 'breakout_volume',
          detected: true,
          grade: 'C',
          summary: `Break down yếu (grade C)`,
          metrics,
        },
      };
    }
    return result;
  }

  result.evidence.summary =
    failReasons.length > 0
      ? failReasons.join('; ')
      : `Vol ${volumeRatio.toFixed(2)}x, chưa breakout khỏi ${fmt(support)}–${fmt(resistance)}`;

  return result;
}

/**
 * Liquidity Sweep Analyzer
 */

import { CandleData } from './setup-gate.analyzer';
import type { PlaybookEvidence } from './setup-gate.types';

export interface LiquiditySweepResult {
  detected: boolean;
  grade: 'A' | 'B' | 'C' | 'D';
  confidence: number;
  reason: string;
  sweepType: 'high' | 'low' | null;
  evidence: PlaybookEvidence;
}

function fmt(n: number, d = 2): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: d });
}

export interface LiquiditySweepOptions {
  /** Prior bars before current candle (default 19). */
  priorBars?: number;
}

export function analyzeLiquiditySweep(
  candles: CandleData[],
  options?: LiquiditySweepOptions
): LiquiditySweepResult {
  const priorBars = options?.priorBars ?? 19;
  const windowCandles = priorBars + 1;

  const baseMetrics: PlaybookEvidence['metrics'] = {
    windowCandles,
  };

  if (candles.length < windowCandles) {
    return {
      detected: false,
      grade: 'D',
      confidence: 0,
      reason: 'Insufficient data for liquidity sweep analysis',
      sweepType: null,
      evidence: {
        playbook: 'liquidity_sweep',
        detected: false,
        grade: 'D',
        summary: `Thiếu dữ liệu (${candles.length}/${windowCandles} nến)`,
        metrics: baseMetrics,
      },
    };
  }

  const recentCandles = candles.slice(-windowCandles);
  const currentCandle = recentCandles[recentCandles.length - 1];
  const recentHighs = recentCandles.slice(0, -1).map((c) => c.high);
  const recentLows = recentCandles.slice(0, -1).map((c) => c.low);
  const highestHigh = Math.max(...recentHighs);
  const lowestLow = Math.min(...recentLows);

  const highSweep = currentCandle.high > highestHigh && currentCandle.close < currentCandle.open;
  const lowSweep = currentCandle.low < lowestLow && currentCandle.close > currentCandle.open;
  const range = currentCandle.high - currentCandle.low;
  const wickTop =
    range > 0
      ? (currentCandle.high - Math.max(currentCandle.open, currentCandle.close)) / range
      : 0;
  const wickBottom =
    range > 0
      ? (Math.min(currentCandle.open, currentCandle.close) - currentCandle.low) / range
      : 0;
  const bodyRatio = range > 0 ? Math.abs(currentCandle.close - currentCandle.open) / range : 0;

  const metrics: PlaybookEvidence['metrics'] = {
    ...baseMetrics,
    priorHigh19: highestHigh,
    priorLow19: lowestLow,
    lastOpen: currentCandle.open,
    lastHigh: currentCandle.high,
    lastLow: currentCandle.low,
    lastClose: currentCandle.close,
    highSweep,
    lowSweep,
    wickTopPct: Math.round(wickTop * 100),
    wickBottomPct: Math.round(wickBottom * 100),
    bodyPct: Math.round(bodyRatio * 100),
  };

  let result: LiquiditySweepResult = {
    detected: false,
    grade: 'D',
    confidence: 0,
    reason: 'No liquidity sweep detected',
    sweepType: null,
    evidence: {
      playbook: 'liquidity_sweep',
      detected: false,
      grade: 'D',
      summary: '',
      metrics,
    },
  };

  if (highSweep) {
    if (wickTop > 0.6 && bodyRatio > 0.2) {
      result = {
        detected: true,
        grade: 'A',
        confidence: 0.85,
        reason: 'Strong high sweep with long wick rejection and solid body',
        sweepType: 'high',
        evidence: {
          playbook: 'liquidity_sweep',
          detected: true,
          grade: 'A',
          summary: `Sweep đỉnh: H ${fmt(currentCandle.high)} > đỉnh 19n ${fmt(highestHigh)}, nến đỏ, wick trên ${(wickTop * 100).toFixed(0)}%`,
          metrics,
        },
      };
    } else if (wickTop > 0.5 && bodyRatio > 0.15) {
      result = {
        detected: true,
        grade: 'B',
        confidence: 0.7,
        reason: 'Moderate high sweep with rejection',
        sweepType: 'high',
        evidence: {
          playbook: 'liquidity_sweep',
          detected: true,
          grade: 'B',
          summary: `Sweep đỉnh vừa: wick ${(wickTop * 100).toFixed(0)}%, body ${(bodyRatio * 100).toFixed(0)}%`,
          metrics,
        },
      };
    } else {
      result = {
        detected: true,
        grade: 'C',
        confidence: 0.55,
        reason: 'Weak high sweep pattern',
        sweepType: 'high',
        evidence: {
          playbook: 'liquidity_sweep',
          detected: true,
          grade: 'C',
          summary: `Sweep đỉnh yếu (chỉ grade C, gate cần B+)`,
          metrics,
        },
      };
    }
  } else if (lowSweep) {
    if (wickBottom > 0.6 && bodyRatio > 0.2) {
      result = {
        detected: true,
        grade: 'A',
        confidence: 0.85,
        reason: 'Strong low sweep with long wick rejection and solid body',
        sweepType: 'low',
        evidence: {
          playbook: 'liquidity_sweep',
          detected: true,
          grade: 'A',
          summary: `Sweep đáy: L ${fmt(currentCandle.low)} < đáy 19n ${fmt(lowestLow)}, nến xanh, wick dưới ${(wickBottom * 100).toFixed(0)}%`,
          metrics,
        },
      };
    } else if (wickBottom > 0.5 && bodyRatio > 0.15) {
      result = {
        detected: true,
        grade: 'B',
        confidence: 0.7,
        reason: 'Moderate low sweep with rejection',
        sweepType: 'low',
        evidence: {
          playbook: 'liquidity_sweep',
          detected: true,
          grade: 'B',
          summary: `Sweep đáy vừa: wick ${(wickBottom * 100).toFixed(0)}%, body ${(bodyRatio * 100).toFixed(0)}%`,
          metrics,
        },
      };
    } else {
      result = {
        detected: true,
        grade: 'C',
        confidence: 0.55,
        reason: 'Weak low sweep pattern',
        sweepType: 'low',
        evidence: {
          playbook: 'liquidity_sweep',
          detected: true,
          grade: 'C',
          summary: `Sweep đáy yếu (chỉ grade C)`,
          metrics,
        },
      };
    }
  } else {
    const parts: string[] = [];
    if (currentCandle.high <= highestHigh) {
      parts.push(
        `H ${fmt(currentCandle.high)} ≤ đỉnh 19n ${fmt(highestHigh)} (chưa quét buy-side)`
      );
    } else if (currentCandle.close >= currentCandle.open) {
      parts.push(`H vượt đỉnh nhưng nến không đỏ (close ≥ open)`);
    }
    if (currentCandle.low >= lowestLow) {
      parts.push(
        `L ${fmt(currentCandle.low)} ≥ đáy 19n ${fmt(lowestLow)} (chưa quét sell-side)`
      );
    } else if (currentCandle.close <= currentCandle.open) {
      parts.push(`L thủng đáy nhưng nến không xanh`);
    }
    result.evidence.summary = parts.length
      ? parts.join('; ')
      : 'Không có sweep + rejection/reclaim trên nến cuối';
  }

  return result;
}

/**
 * Market Regime Analyzer
 * Detects: trend | range | chop (with numeric evidence)
 */

import { getRegimeStrongTrendMinPct, getRegimeTrendMinPct } from '../config/v3-regime-policy';
import { CandleData } from './setup-gate.analyzer';
import type { RegimeEvidence } from './setup-gate.types';

export type MarketRegime = 'trend' | 'range' | 'chop';

export interface MarketRegimeResult {
  regime: MarketRegime;
  trendDirection: 'bullish' | 'bearish' | null;
  confidence: number;
  reason: string;
}

function computeCoreMetrics(candles: CandleData[]) {
  const recentCandles = candles;
  const closes = recentCandles.map((c) => c.close);
  const n = closes.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += closes[i];
    sumXY += i * closes[i];
    sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const avgPrice = sumY / n;
  const trendStrengthPct = Math.abs(slope / avgPrice) * 100;

  const variance = closes.reduce((acc, val) => acc + Math.pow(val - avgPrice, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  const volatilityPct = (stdDev / avgPrice) * 100;

  const highs = recentCandles.map((c) => c.high);
  const lows = recentCandles.map((c) => c.low);
  const rangePct = ((Math.max(...highs) - Math.min(...lows)) / avgPrice) * 100;

  const currentPrice = closes[closes.length - 1];
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const sma50 = closes.reduce((a, b) => a + b, 0) / n;

  let trendDirection: 'bullish' | 'bearish' | null = null;
  if (currentPrice > sma20 && sma20 > sma50) trendDirection = 'bullish';
  else if (currentPrice < sma20 && sma20 < sma50) trendDirection = 'bearish';

  return {
    avgPrice,
    currentPrice,
    trendStrengthPct,
    volatilityPct,
    rangePct,
    trendDirection,
    sma20,
    sma50,
  };
}

export interface RegimeEvidenceOptions {
  regimeBars?: number;
  timeframe?: string;
}

/**
 * Regime + rule path + numbers used for that scan.
 */
export function computeRegimeEvidence(
  candles: CandleData[],
  options?: RegimeEvidenceOptions
): RegimeEvidence {
  const regimeBars = options?.regimeBars ?? 50;
  const is5m = options?.timeframe === '5m';
  const minBars = Math.min(50, regimeBars);

  if (candles.length < minBars) {
    const last = candles[candles.length - 1];
    return {
      regime: 'chop',
      volatilityPct: 0,
      trendStrengthPct: 0,
      rangePct: 0,
      avgPrice: last?.close ?? 0,
      currentPrice: last?.close ?? 0,
      matchedRule: `Thiếu dữ liệu: ${candles.length}/50 nến → mặc định chop`,
      trendDirection: null,
    };
  }

  const recent = candles.slice(-regimeBars);
  const m = computeCoreMetrics(recent);
  let regime: MarketRegime = 'range';
  let matchedRule: string;

  const tf = options?.timeframe ?? '15m';
  const trendMin = getRegimeTrendMinPct(tf);
  const strongTrendMin = getRegimeStrongTrendMinPct();
  const chopVol = is5m ? 2.5 : 2.0;
  const rangeBandPct = is5m ? 1.0 : 1.5;
  const rangeVolPct = is5m ? 1.2 : 1.0;

  if (m.volatilityPct > chopVol && m.trendStrengthPct < 0.1) {
    regime = 'chop';
    matchedRule =
      `CHOP: biến động ${m.volatilityPct.toFixed(2)}% > ${chopVol}% và độ trend ${m.trendStrengthPct.toFixed(2)}% < 0.1% (nhiễu, không có hướng rõ)`;
  } else if (m.trendStrengthPct > strongTrendMin) {
    regime = 'trend';
    matchedRule = `TREND: độ trend ${m.trendStrengthPct.toFixed(2)}% > ${strongTrendMin}%`;
  } else if (m.rangePct < rangeBandPct && m.volatilityPct < rangeVolPct) {
    regime = 'range';
    matchedRule =
      `RANGE: biên ${regimeBars}n ${m.rangePct.toFixed(2)}% < ${rangeBandPct}% và biến động ${m.volatilityPct.toFixed(2)}% < ${rangeVolPct}%`;
  } else if (m.trendStrengthPct > trendMin) {
    regime = 'trend';
    matchedRule = `TREND (${tf}): độ trend ${m.trendStrengthPct.toFixed(2)}% > ${trendMin}%`;
  } else {
    regime = 'range';
    matchedRule =
      `RANGE (mặc định): trend ${m.trendStrengthPct.toFixed(2)}%, biến động ${m.volatilityPct.toFixed(2)}%, biên ${m.rangePct.toFixed(2)}%`;
  }

  return {
    regime,
    volatilityPct: m.volatilityPct,
    trendStrengthPct: m.trendStrengthPct,
    rangePct: m.rangePct,
    avgPrice: m.avgPrice,
    currentPrice: m.currentPrice,
    matchedRule,
    trendDirection: regime === 'trend' ? m.trendDirection : null,
  };
}

export function analyzeMarketRegime(candles: CandleData[]): MarketRegime {
  return computeRegimeEvidence(candles).regime;
}

export function getMarketRegimeDetails(candles: CandleData[]): MarketRegimeResult {
  const ev = computeRegimeEvidence(candles);
  return {
    regime: ev.regime,
    trendDirection: ev.trendDirection,
    confidence: ev.regime === 'trend' ? 0.8 : ev.regime === 'range' ? 0.7 : 0.6,
    reason: ev.matchedRule,
  };
}

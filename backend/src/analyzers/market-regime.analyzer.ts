/**
 * Market Regime Analyzer
 * Detects:
 * - trend
 * - range
 * - chop
 */

import { CandleData } from './setup-gate.analyzer';

export type MarketRegime = 'trend' | 'range' | 'chop';

export interface MarketRegimeResult {
  regime: MarketRegime;
  trendDirection: 'bullish' | 'bearish' | null;
  confidence: number;
  reason: string;
}

/**
 * Analyze candles to determine market regime
 */
export function analyzeMarketRegime(candles: CandleData[]): MarketRegime {
  if (candles.length < 50) {
    return 'chop';
  }

  const recentCandles = candles.slice(-50);
  const closes = recentCandles.map(c => c.close);

  // Calculate trend strength using linear regression slope
  const n = closes.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += closes[i];
    sumXY += i * closes[i];
    sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const avgPrice = sumY / n;
  const trendStrength = Math.abs(slope / avgPrice) * 100; // Percentage

  // Calculate volatility (standard deviation)
  const variance = closes.reduce((acc, val) => acc + Math.pow(val - avgPrice, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  const volatility = stdDev / avgPrice * 100;

  // Calculate range boundness
  const highs = recentCandles.map(c => c.high);
  const lows = recentCandles.map(c => c.low);
  const range = (Math.max(...highs) - Math.min(...lows)) / avgPrice * 100;

  // Determine regime
  if (volatility > 2.0 && trendStrength < 0.1) {
    return 'chop';
  }

  if (trendStrength > 0.3) {
    return 'trend';
  }

  if (range < 1.5 && volatility < 1.0) {
    return 'range';
  }

  // Default to trend if moderate strength
  if (trendStrength > 0.15) {
    return 'trend';
  }

  return 'range';
}

/**
 * Get detailed market regime analysis
 */
export function getMarketRegimeDetails(candles: CandleData[]): MarketRegimeResult {
  const regime = analyzeMarketRegime(candles);
  const recentCandles = candles.slice(-50);
  const closes = recentCandles.map(c => c.close);

  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const sma50 = closes.reduce((a, b) => a + b, 0) / 50;
  const currentPrice = closes[closes.length - 1];

  let trendDirection: 'bullish' | 'bearish' | null = null;
  if (regime === 'trend') {
    trendDirection = currentPrice > sma20 && sma20 > sma50 ? 'bullish' : 'bearish';
  }

  return {
    regime,
    trendDirection,
    confidence: regime === 'trend' ? 0.8 : regime === 'range' ? 0.7 : 0.6,
    reason: `Regime: ${regime}${trendDirection ? `, Direction: ${trendDirection}` : ''}`
  };
}

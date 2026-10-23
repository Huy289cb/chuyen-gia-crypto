/**
 * Market Regime Analyzer
 * Detects: trend | range | chop (with numeric evidence)
 */
import { CandleData } from './setup-gate.analyzer';
import type { RegimeEvidence } from './setup-gate.types';
export type MarketRegime = 'trend' | 'range' | 'chop';
export interface MarketRegimeResult {
    regime: MarketRegime;
    trendDirection: 'bullish' | 'bearish' | null;
    confidence: number;
    reason: string;
}
export interface RegimeEvidenceOptions {
    regimeBars?: number;
    timeframe?: string;
}
/**
 * Regime + rule path + numbers used for that scan.
 */
export declare function computeRegimeEvidence(candles: CandleData[], options?: RegimeEvidenceOptions): RegimeEvidence;
export declare function analyzeMarketRegime(candles: CandleData[]): MarketRegime;
export declare function getMarketRegimeDetails(candles: CandleData[]): MarketRegimeResult;
//# sourceMappingURL=market-regime.analyzer.d.ts.map
import type { MarketRegime } from './market-regime.analyzer';

export interface RegimeEvidence {
  regime: MarketRegime;
  volatilityPct: number;
  trendStrengthPct: number;
  rangePct: number;
  avgPrice: number;
  currentPrice: number;
  matchedRule: string;
  trendDirection: 'bullish' | 'bearish' | null;
}

export interface PlaybookEvidence {
  playbook: 'liquidity_sweep' | 'breakout_volume';
  detected: boolean;
  grade: 'A' | 'B' | 'C' | 'D';
  summary: string;
  /** Key metrics from the scan candle window */
  metrics: Record<string, string | number | boolean | null>;
}

export interface SetupGateEvidence {
  symbol: string;
  timeframe: string;
  candleCount: number;
  lastCandleTime: number | null;
  price: number;
  regime: RegimeEvidence;
  playbooks: PlaybookEvidence[];
}

import type { SourcePortfolioTargets } from './types';

export interface CctCoinMetadata {
  [key: string]: unknown;
  observedDailyBars: number;
  eligible360BarsAnd90Vol: boolean;
  annVol90: number | null;
  signedSignalCount: number;
  signalStates: Record<string, number>;
  priorStopsTestedToday: Record<string, number | null>;
  nextStops: Record<string, number | null>;
  reasons: Record<string, string>;
  signalCountChanged: boolean;
  stateVectorChanged: boolean;
  baseDesiredSleeveWeight: number;
  /** Frozen indicator diagnostics retain its original scalar4 definition. */
  scaledDesiredSleeveWeight: number;
  currentReferenceSleeveWeight: number;
  referenceBandRequestedSleeveWeight: number;
  referenceBandResize: boolean;
}

export interface CctSourcePortfolioTargets extends SourcePortfolioTargets {
  strategy: 'cct-lc-b5-v1';
  policyId: 'CCT_LC_B5_S6_BUFFER11_V1';
  originalSourceId: string;
  sourceSizingScalar: 6;
  generatedSourceSizingScalar: 4;
  mode: 'long_cash';
  metadata: Record<string, CctCoinMetadata>;
  /** Exact frozen source4 JSON decimal × .75 × 2; numbers are presentation only. */
  decimalWeights: Record<string, string>;
  baseDesiredWeights: Record<string, number>;
  /** Unfunded source4 sleeve diagnostic; never use as actual wallet inventory. */
  referenceBandRequestedWeights: Record<string, number>;
}

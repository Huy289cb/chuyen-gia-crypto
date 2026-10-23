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
export interface LiquiditySweepOptions {
    /** Prior bars before current candle (default 19). */
    priorBars?: number;
}
export declare function analyzeLiquiditySweep(candles: CandleData[], options?: LiquiditySweepOptions): LiquiditySweepResult;
//# sourceMappingURL=liquidity-sweep.analyzer.d.ts.map
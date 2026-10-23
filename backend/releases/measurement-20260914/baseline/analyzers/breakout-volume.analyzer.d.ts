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
export interface BreakoutVolumeOptions {
    windowBars?: number;
}
export declare function analyzeBreakoutVolume(candles: CandleData[], options?: BreakoutVolumeOptions): BreakoutVolumeResult;
//# sourceMappingURL=breakout-volume.analyzer.d.ts.map
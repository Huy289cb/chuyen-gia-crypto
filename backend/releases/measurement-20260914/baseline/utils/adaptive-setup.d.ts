import type { StructureBias, StructureBiasResult } from '../config/v3-structure-bias-policy';
import { type StructureCandle } from './structure-bias';
import type { AdaptiveSetupKind } from '../config/adaptive-setup-policy';
export type AdaptiveSide = 'long' | 'short';
export interface AdaptiveHtfState {
    fresh: boolean;
    regime: 'trend' | 'range' | 'chop' | 'unknown';
    trendDirection: 'bullish' | 'bearish' | null;
    candles: StructureCandle[];
}
export interface AdaptiveDetectionInput {
    side: AdaptiveSide;
    timeframe: string;
    playbook: string;
    grade: string;
    close: number;
    boundary: number | null;
    structureBias: StructureBias | null;
    structureDetail: StructureBiasResult | null;
    htf1h: AdaptiveHtfState;
    htf15m: AdaptiveHtfState;
    selectedMetrics?: Record<string, unknown> | null;
    rangeEdgeFraction?: number;
    microBosStrength?: number;
    microRequire1hAlign?: boolean;
    rangeLong5mOnly?: boolean;
}
export interface AdaptiveDetectionResult {
    kind: AdaptiveSetupKind;
    boundary: number;
    evidence: Record<string, unknown>;
}
export declare function expectedTrendDirection(side: AdaptiveSide): 'bullish' | 'bearish';
export declare function isGradeBorBetter(grade: string): boolean;
/** Latest confirmed local pivot must be broken by the latest close. */
export declare function hasMicroBos(side: AdaptiveSide, candles: StructureCandle[], strength?: number): {
    pass: boolean;
    level: number | null;
};
/**
 * Shared pure detector used by live shadow registration and historical replay.
 * Priority is intentional: a true counter-structure flip is more specific than
 * an aligned micro breakout, while range sweep uses a separate playbook.
 */
export declare function detectAdaptiveSetup(input: AdaptiveDetectionInput): AdaptiveDetectionResult | null;
export declare function retestCandleRejects(side: AdaptiveSide, candle: Pick<StructureCandle, 'high' | 'low' | 'close'> & {
    open?: number;
}): boolean;
//# sourceMappingURL=adaptive-setup.d.ts.map
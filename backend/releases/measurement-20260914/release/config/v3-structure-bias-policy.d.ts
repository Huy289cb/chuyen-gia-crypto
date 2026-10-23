/**
 * Structure-first bias permission (Phase A).
 * See docs/structure-first-bias-plan.md
 */
import { type StructureBias, type StructureBiasResult, type StructureCandle } from '../utils/structure-bias';
export type { StructureBias, StructureBiasResult };
/** Short needs LH+LL + BOS (close below prior swing low). Default on. */
export declare function isV3StructureShortRequireBos(): boolean;
/** Long needs HH+HL + BOS (close above prior swing high). Default on — mirror short. */
export declare function isV3StructureLongRequireBos(): boolean;
export declare function isV3StructureBiasEnabled(): boolean;
export declare function getV3StructureBiasTf(): string;
export declare function getV3StructureBiasStrength(): number;
/** Candle limit for structure TF (need room for pivots). */
export declare function getV3StructureBiasCandleLimit(): number;
export interface StructureSidePermission {
    pass: boolean;
    bias: StructureBias;
    reason?: string;
    detail?: StructureBiasResult;
}
/**
 * bull → long only (+BOS); bear → short only (+BOS); transition → flat.
 * Short: block LH+LL reclaim (Aug-24). Long: block HH+HL relief in bear (Aug 8–12 mirror).
 */
export declare function evaluateStructureSidePermission(input: {
    side: 'long' | 'short';
    candles: StructureCandle[];
    enabled?: boolean;
    strength?: number;
    shortRequireBos?: boolean;
    longRequireBos?: boolean;
}): StructureSidePermission;
/** Playbook direction must match LLM side (Phase B). Default on. */
export declare function isV3RequirePlaybookSideMatch(): boolean;
export interface PlaybookSideMatchResult {
    pass: boolean;
    reason?: string;
}
export declare function evaluatePlaybookSideMatch(input: {
    llmSide: 'long' | 'short';
    playbookSide: 'long' | 'short' | null;
    enabled?: boolean;
}): PlaybookSideMatchResult;
/** Facts for LLM confirm/veto — do not let the model invent HTF/playbook. */
export declare function formatLlmGateContext(input: {
    timeframe: string;
    playbookKey: string;
    playbookSide: 'long' | 'short' | null;
    structureBias?: 'bull' | 'bear' | 'transition';
    htfTf?: string;
    htfRegime?: string;
    htfDirection?: string | null;
}): string;
//# sourceMappingURL=v3-structure-bias-policy.d.ts.map
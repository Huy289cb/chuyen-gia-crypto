/**
 * Named testbed variants for walk-forward rule comparison (no runtime side effects).
 */
export interface TestbedVariant {
    id: string;
    label: string;
    minGrade?: 'A' | 'B';
    minConfidence?: number;
    gradeBMinConfidence?: number;
    gradeBAllowedPlaybooks?: string[];
    allowedRegimes?: Array<'trend' | 'range' | 'chop'>;
    blockRangeEntries?: boolean;
    /** Allow range candidates to skip the generic HTF-regime=trend gate. */
    skipHtfTrendForRange?: boolean;
    /** Optional extra allowlist applied only when the candidate regime is range/chop. */
    rangeAllowedPlaybooks?: string[];
    structureBiasEnabled?: boolean;
    structureShortRequireBos?: boolean;
    structureLongRequireBos?: boolean;
    requireHtfSideAlign?: boolean;
    htfSideAlignFailClosed?: boolean;
    requirePullback?: boolean;
    pullbackMaxAbovePct?: number;
    breakoutPullbackMaxAbovePct?: number;
    pullbackMaxBelowPct?: number;
    block5mWhen1hRange?: boolean;
    require5mHtfConfirm?: boolean;
    enableCooldown?: boolean;
}
export declare const TESTBED_VARIANTS: Record<string, TestbedVariant>;
export declare function resolveTestbedVariant(id: string | undefined): TestbedVariant;
//# sourceMappingURL=testbed-variants.d.ts.map
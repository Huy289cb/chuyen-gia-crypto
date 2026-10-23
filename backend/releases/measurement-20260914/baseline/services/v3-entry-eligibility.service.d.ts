/**
 * Shared entry eligibility for LLM dispatch and V3 execution (scale-in within exposure cap).
 */
export type LocalSide = 'long' | 'short';
export interface SymbolExposureSnapshot {
    openUsd: number;
    pendingUsd: number;
    totalUsd: number;
    maxExposureUsd: number;
    remainingUsd: number;
    openSides: LocalSide[];
    pendingSides: LocalSide[];
}
export declare function oppositeLocalSide(side: LocalSide): LocalSide;
export declare function getSymbolExposureSnapshot(symbol: string, methodId?: string): Promise<SymbolExposureSnapshot>;
/**
 * Anti-chase: block either-side entry soon after a close (longer after a loss).
 */
export declare function assertSameSidePostCloseCooldown(symbol: string, _side: LocalSide, methodId?: string): Promise<string | null>;
export declare function canRunLlmDispatchForSymbol(symbol: string, methodId?: string): Promise<{
    allowed: boolean;
    reason: string;
}>;
export declare function assertScaleInSideAllowed(symbol: string, side: LocalSide): Promise<string | null>;
//# sourceMappingURL=v3-entry-eligibility.service.d.ts.map
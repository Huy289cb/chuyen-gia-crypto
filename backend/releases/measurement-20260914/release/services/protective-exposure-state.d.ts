export interface ProtectiveExposureEntryBlock {
    reason: string;
    until: number;
    updatedAt: number;
}
export declare function setProtectiveExposureEntryBlock(reason: string, ttlMs: number): void;
export declare function clearProtectiveExposureEntryBlock(): void;
export declare function getProtectiveExposureEntryBlock(): ProtectiveExposureEntryBlock | null;
//# sourceMappingURL=protective-exposure-state.d.ts.map
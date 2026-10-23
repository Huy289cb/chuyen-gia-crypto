export type AdaptiveSetupKind = 'early_structure_flip' | 'aligned_micro_bos' | 'range_sweep_reclaim';
export type AdaptiveSetupMode = 'off' | 'shadow' | 'live';
export declare function getAdaptiveSetupMode(): AdaptiveSetupMode;
export declare function isAdaptiveSetupShadowEnabled(): boolean;
export declare function isAdaptiveSetupLiveEnabled(): boolean;
export declare function isEarlyStructureFlipEnabled(): boolean;
export declare function isAlignedMicroBosEnabled(): boolean;
export declare function isRangeSweepReclaimEnabled(): boolean;
export declare function isAlignedMicroBosRequire1hAlign(): boolean;
export declare function isRangeSweepLong5mOnly(): boolean;
export declare function getAdaptiveSetupTtlMinutes(kind: AdaptiveSetupKind): number;
export declare function getAdaptiveSetupRr(kind: AdaptiveSetupKind): number;
/** Fraction of the 1h range considered an edge (0.30 = outer 30%). */
export declare function getRangeSweepEdgeFraction(): number;
export declare function getAdaptiveMicroBosStrength(): number;
export declare function isRangeSweepRetestBosRequired(): boolean;
export declare function isRangeSweepTargetRoomRequired(): boolean;
export declare function getAdaptiveFeePctPerSide(): number;
//# sourceMappingURL=adaptive-setup-policy.d.ts.map
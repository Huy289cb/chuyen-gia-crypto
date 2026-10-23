export interface AutoEntryConfig {
    minConfidence: number;
    minRRRatio: number;
    riskPerTrade: number;
    maxPositionsPerSymbol: number;
    maxVolumePerAccount: number;
    maxOpenVolume: number;
    maxPendingVolume: number;
    maxPositionSize: number;
    maxPendingOrderSize: number;
    cooldownAfterLosses: number;
    cooldownDuration: number;
    maxConsecutiveLosses: number;
    cooldownHours: number;
    enabledSymbols: string[];
    allowedSessions: string[];
    requiredTimeframes: string[];
    minAlignment: number;
    minSLDistancePercent: number;
    requireConfluence: boolean;
    minConfluenceCount: number;
    requireHighLiquiditySession: boolean;
    requireMarketStructure: boolean;
}
export interface MethodConfig {
    methodId: string;
    name: string;
    description: string;
    scheduleOffset: number;
    enabled: boolean;
    systemPrompt: string;
    autoEntry: AutoEntryConfig;
}
export declare const METHODS: Record<string, MethodConfig>;
export declare const ENABLED_METHODS: MethodConfig[];
export declare function getMethodById(methodId: string): MethodConfig | null;
export declare function getMethodConfig(methodId: string): MethodConfig;
//# sourceMappingURL=methods.d.ts.map
/**
 * Risk Policy Configuration
 * Defines risk limits and parameters for the trading system
 */
export interface RiskPolicyConfig {
    riskPerTradePercent: number;
    /**
     * Hard ceiling after exchange min-notional/min-quantity rounding.
     * The requested risk can be smaller than the risk of one exchange lot on a small wallet.
     */
    maxEffectiveRiskPerTradePercent: number;
    /** Explicit fixed-dollar ceiling overrides the percent ceiling when configured. */
    maxEffectiveRiskPerTradeUsd?: number | null;
    /** Tighten wide stops only when one exchange minimum lot would exceed the cap. */
    minimumLotStopNormalizationEnabled: boolean;
    /** Upper stop distance selected inside the feasible min-lot band. */
    minimumLotNormalizedStopMaxPercent: number;
    dailyLossLimitPercent: number;
    maxConsecutiveLosses: number;
    consecutiveLossCooldownHours: number;
    /** After this many consecutive losses, pause entries (tier 2). */
    lossCooldownTier2MinStreak: number;
    lossCooldownTier2Hours: number;
    /** After this many consecutive losses, longer pause (tier 3). */
    lossCooldownTier3MinStreak: number;
    lossCooldownTier3Hours: number;
    /** Tier 3 also waits until end of UTC day when true (uses max(12h, EOD)). */
    lossCooldownTier3UntilUtcDay: boolean;
    maxSpreadPercent: number;
    maxSlippagePercent: number;
    maxFeePercent: number;
    volatilityMultiplier: number;
    highVolatilityThreshold: number;
    minSignalGrade: 'A' | 'B' | 'C' | 'D';
    minSignalConfidence: number;
    maxPositionsPerSymbol: number;
    maxTotalPositions: number;
    /** Max combined USD notional: open positions + pending limit orders */
    maxTotalExposureUsd: number;
    /**
     * When set via MAX_EXPOSURE_PCT_OF_EQUITY env, caps exposure as fraction of wallet (overrides flat USD if > 0).
     */
    maxExposurePercentOfEquity: number | null;
    /** Min |entry − SL| / entry before placing order (e.g. 0.005 = 0.5%) */
    minSlDistancePercent: number;
    /** Peak-equity drawdown % that blocks new entries (Phase 0 circuit). */
    maxDrawdownPercent: number;
    circuitDailyLossEnabled: boolean;
    circuitDrawdownEnabled: boolean;
    /** Pause when last N closes sumR <= minSumR. */
    circuitExpectancyKillEnabled: boolean;
    circuitExpectancyWindow: number;
    circuitExpectancyMinSumR: number;
    circuitExpectancyCooldownHours: number;
    /** If set, peak equity for DD = max(this, current); ignores snapshot history. */
    circuitPeakEquityOverride: number | null;
    /** If set, expectancy kill only uses outcomes with timestamp >= this. */
    circuitExpectancySince: Date | null;
}
export declare const DEFAULT_RISK_POLICY: RiskPolicyConfig;
/**
 * Get risk policy from environment or use defaults
 */
export declare function getRiskPolicy(): RiskPolicyConfig;
/**
 * Tiered cooldown after consecutive losses:
 * - streak >= tier2: lastLoss + tier2 hours
 * - streak >= tier3: max(lastLoss + tier3 hours, end of UTC day) when untilUtcDay enabled
 */
export declare function resolveLossCooldownUntil(consecutiveLosses: number, fromTime?: Date): Date | null;
//# sourceMappingURL=risk-policy.d.ts.map
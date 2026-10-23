"use strict";
/**
 * Risk Policy Configuration
 * Defines risk limits and parameters for the trading system
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_RISK_POLICY = void 0;
exports.getRiskPolicy = getRiskPolicy;
exports.resolveLossCooldownUntil = resolveLossCooldownUntil;
const mainnet_safety_1 = require("./mainnet-safety");
exports.DEFAULT_RISK_POLICY = {
    riskPerTradePercent: 0.5, // 0.5% per trade
    maxEffectiveRiskPerTradePercent: 2, // reject a min-lot order above 2% wallet risk
    maxEffectiveRiskPerTradeUsd: null,
    minimumLotStopNormalizationEnabled: false,
    minimumLotNormalizedStopMaxPercent: 0.0084,
    dailyLossLimitPercent: 2.0, // Stop after 2% daily loss
    maxConsecutiveLosses: 3, // Stop after 3 consecutive losses
    consecutiveLossCooldownHours: 4, // Legacy flat cooldown
    lossCooldownTier2MinStreak: 2,
    lossCooldownTier2Hours: 6,
    lossCooldownTier3MinStreak: 3,
    lossCooldownTier3Hours: 12,
    lossCooldownTier3UntilUtcDay: true,
    maxSpreadPercent: 0.05, // 0.05% max spread
    maxSlippagePercent: 0.1, // 0.1% max slippage
    maxFeePercent: 0.1, // 0.1% max fee
    volatilityMultiplier: 0.5, // Reduce size by 50% in high volatility
    highVolatilityThreshold: 1.0, // 1% ATR considered high volatility
    minSignalGrade: 'A',
    minSignalConfidence: 0.75,
    maxPositionsPerSymbol: 1,
    maxTotalPositions: 2,
    maxTotalExposureUsd: 2000,
    maxExposurePercentOfEquity: null,
    minSlDistancePercent: 0.004,
    maxDrawdownPercent: 15,
    circuitDailyLossEnabled: true,
    circuitDrawdownEnabled: true,
    circuitExpectancyKillEnabled: true,
    circuitExpectancyWindow: 10,
    circuitExpectancyMinSumR: -3,
    circuitExpectancyCooldownHours: 168,
    circuitPeakEquityOverride: null,
    circuitExpectancySince: null,
};
/**
 * Get risk policy from environment or use defaults
 */
function getRiskPolicy() {
    const configuredRiskPercent = parseFloat(process.env.RISK_PER_TRADE_PERCENT || '0.5');
    const configuredMaxExposureUsd = parseFloat(process.env.MAX_TOTAL_EXPOSURE_USD ||
        process.env.MAX_PENDING_VOLUME_USD ||
        '2000');
    return {
        riskPerTradePercent: (0, mainnet_safety_1.getEffectiveRiskPerTradePercent)(configuredRiskPercent),
        maxEffectiveRiskPerTradePercent: (() => {
            const value = parseFloat(process.env.MAX_EFFECTIVE_RISK_PER_TRADE_PERCENT || '2');
            return Number.isFinite(value) && value > 0 ? value : 2;
        })(),
        maxEffectiveRiskPerTradeUsd: (() => {
            const value = Number(process.env.MAX_EFFECTIVE_RISK_PER_TRADE_USD);
            return Number.isFinite(value) && value > 0 ? value : null;
        })(),
        minimumLotStopNormalizationEnabled: process.env.MINIMUM_LOT_STOP_NORMALIZATION_ENABLED === 'true',
        minimumLotNormalizedStopMaxPercent: (() => {
            const value = parseFloat(process.env.MINIMUM_LOT_NORMALIZED_STOP_MAX_PERCENT || '0.0084');
            return Number.isFinite(value) && value > 0 ? value : 0.0084;
        })(),
        dailyLossLimitPercent: parseFloat(process.env.DAILY_LOSS_LIMIT_PERCENT || '2.0'),
        maxConsecutiveLosses: parseInt(process.env.MAX_CONSECUTIVE_LOSSES || '3'),
        consecutiveLossCooldownHours: parseFloat(process.env.CONSECUTIVE_LOSS_COOLDOWN_HOURS || '4'),
        lossCooldownTier2MinStreak: parseInt(process.env.LOSS_COOLDOWN_TIER2_MIN_STREAK || '2', 10),
        lossCooldownTier2Hours: parseFloat(process.env.LOSS_COOLDOWN_TIER2_HOURS || '6'),
        lossCooldownTier3MinStreak: parseInt(process.env.LOSS_COOLDOWN_TIER3_MIN_STREAK || '3', 10),
        lossCooldownTier3Hours: parseFloat(process.env.LOSS_COOLDOWN_TIER3_HOURS || '12'),
        lossCooldownTier3UntilUtcDay: process.env.LOSS_COOLDOWN_TIER3_UNTIL_UTC_DAY !== 'false',
        maxSpreadPercent: parseFloat(process.env.MAX_SPREAD_PERCENT || '0.05'),
        maxSlippagePercent: parseFloat(process.env.MAX_SLIPPAGE_PERCENT || '0.1'),
        maxFeePercent: parseFloat(process.env.MAX_FEE_PERCENT || '0.1'),
        volatilityMultiplier: parseFloat(process.env.VOLATILITY_MULTIPLIER || '0.5'),
        highVolatilityThreshold: parseFloat(process.env.HIGH_VOLATILITY_THRESHOLD || '1.0'),
        minSignalGrade: (process.env.MIN_SIGNAL_GRADE || 'A'),
        minSignalConfidence: parseFloat(process.env.MIN_SIGNAL_CONFIDENCE || '0.75'),
        maxPositionsPerSymbol: parseInt(process.env.MAX_POSITIONS_PER_SYMBOL || '1', 10),
        maxTotalPositions: parseInt(process.env.MAX_TOTAL_POSITIONS || '2', 10),
        maxTotalExposureUsd: (0, mainnet_safety_1.getEffectiveMaxExposureUsd)(configuredMaxExposureUsd),
        maxExposurePercentOfEquity: (() => {
            const v = process.env.MAX_EXPOSURE_PCT_OF_EQUITY?.trim();
            if (!v)
                return null;
            const pct = parseFloat(v);
            return Number.isFinite(pct) && pct > 0 ? pct : null;
        })(),
        minSlDistancePercent: parseFloat(process.env.MIN_SL_DISTANCE_PERCENT || '0.004'),
        maxDrawdownPercent: parseFloat(process.env.MAX_DRAWDOWN_PERCENT || '15'),
        circuitDailyLossEnabled: process.env.CIRCUIT_DAILY_LOSS_ENABLED !== 'false',
        circuitDrawdownEnabled: process.env.CIRCUIT_DRAWDOWN_ENABLED !== 'false',
        circuitExpectancyKillEnabled: process.env.CIRCUIT_EXPECTANCY_KILL_ENABLED !== 'false',
        circuitExpectancyWindow: parseInt(process.env.CIRCUIT_EXPECTANCY_WINDOW || '10', 10),
        circuitExpectancyMinSumR: parseFloat(process.env.CIRCUIT_EXPECTANCY_MIN_SUM_R || '-3'),
        circuitExpectancyCooldownHours: parseFloat(process.env.CIRCUIT_EXPECTANCY_COOLDOWN_HOURS || '168'),
        circuitPeakEquityOverride: (() => {
            const v = process.env.CIRCUIT_PEAK_EQUITY?.trim();
            if (!v)
                return null;
            const n = parseFloat(v);
            return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        circuitExpectancySince: (() => {
            const v = process.env.CIRCUIT_EXPECTANCY_SINCE?.trim();
            if (!v)
                return null;
            const d = new Date(v);
            return Number.isFinite(d.getTime()) ? d : null;
        })(),
    };
}
function endOfUtcDay(from) {
    const e = new Date(from);
    e.setUTCHours(23, 59, 59, 999);
    return e;
}
/**
 * Tiered cooldown after consecutive losses:
 * - streak >= tier2: lastLoss + tier2 hours
 * - streak >= tier3: max(lastLoss + tier3 hours, end of UTC day) when untilUtcDay enabled
 */
function resolveLossCooldownUntil(consecutiveLosses, fromTime = new Date()) {
    const policy = getRiskPolicy();
    if (consecutiveLosses < policy.lossCooldownTier2MinStreak) {
        return null;
    }
    if (consecutiveLosses < policy.lossCooldownTier3MinStreak) {
        return new Date(fromTime.getTime() + policy.lossCooldownTier2Hours * 3_600_000);
    }
    const plusHours = new Date(fromTime.getTime() + policy.lossCooldownTier3Hours * 3_600_000);
    if (!policy.lossCooldownTier3UntilUtcDay) {
        return plusHours;
    }
    const eod = endOfUtcDay(fromTime);
    return plusHours.getTime() > eod.getTime() ? plusHours : eod;
}
//# sourceMappingURL=risk-policy.js.map
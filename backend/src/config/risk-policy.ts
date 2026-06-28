/**
 * Risk Policy Configuration
 * Defines risk limits and parameters for the trading system
 */

import {
  getEffectiveMaxExposureUsd,
  getEffectiveRiskPerTradePercent,
} from './mainnet-safety';

export interface RiskPolicyConfig {
  // Risk per trade
  riskPerTradePercent: number; // e.g., 0.5% - 1% of account balance
  
  // Daily loss cap
  dailyLossLimitPercent: number; // Stop trading after X% loss/day
  
  // Consecutive losses
  maxConsecutiveLosses: number; // After X losses → reduce size or stop
  consecutiveLossCooldownHours: number; // Hours to wait after hitting max consecutive losses
  
  // Execution cost filters
  maxSpreadPercent: number; // Maximum allowed spread as percentage of price
  maxSlippagePercent: number; // Maximum expected slippage
  maxFeePercent: number; // Maximum fee as percentage of trade value
  
  // Volatility-based position sizing
  volatilityMultiplier: number; // Reduce size in high volatility
  highVolatilityThreshold: number; // ATR as percentage of price
  
  // Signal quality requirements
  minSignalGrade: 'A' | 'B' | 'C' | 'D';
  minSignalConfidence: number; // 0-1 scale
  
  // Position limits
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
}

export const DEFAULT_RISK_POLICY: RiskPolicyConfig = {
  riskPerTradePercent: 0.5, // 0.5% per trade
  dailyLossLimitPercent: 2.0, // Stop after 2% daily loss
  maxConsecutiveLosses: 3, // Stop after 3 consecutive losses
  consecutiveLossCooldownHours: 4, // Wait 4 hours after 3 losses
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
};

/**
 * Get risk policy from environment or use defaults
 */
export function getRiskPolicy(): RiskPolicyConfig {
  const configuredRiskPercent = parseFloat(process.env.RISK_PER_TRADE_PERCENT || '0.5');
  const configuredMaxExposureUsd = parseFloat(
    process.env.MAX_TOTAL_EXPOSURE_USD ||
      process.env.MAX_PENDING_VOLUME_USD ||
      '2000'
  );

  return {
    riskPerTradePercent: getEffectiveRiskPerTradePercent(configuredRiskPercent),
    dailyLossLimitPercent: parseFloat(process.env.DAILY_LOSS_LIMIT_PERCENT || '2.0'),
    maxConsecutiveLosses: parseInt(process.env.MAX_CONSECUTIVE_LOSSES || '3'),
    consecutiveLossCooldownHours: parseFloat(process.env.CONSECUTIVE_LOSS_COOLDOWN_HOURS || '4'),
    maxSpreadPercent: parseFloat(process.env.MAX_SPREAD_PERCENT || '0.05'),
    maxSlippagePercent: parseFloat(process.env.MAX_SLIPPAGE_PERCENT || '0.1'),
    maxFeePercent: parseFloat(process.env.MAX_FEE_PERCENT || '0.1'),
    volatilityMultiplier: parseFloat(process.env.VOLATILITY_MULTIPLIER || '0.5'),
    highVolatilityThreshold: parseFloat(process.env.HIGH_VOLATILITY_THRESHOLD || '1.0'),
    minSignalGrade: (process.env.MIN_SIGNAL_GRADE || 'A') as 'A' | 'B' | 'C' | 'D',
    minSignalConfidence: parseFloat(process.env.MIN_SIGNAL_CONFIDENCE || '0.75'),
    maxPositionsPerSymbol: parseInt(process.env.MAX_POSITIONS_PER_SYMBOL || '1', 10),
    maxTotalPositions: parseInt(process.env.MAX_TOTAL_POSITIONS || '2', 10),
    maxTotalExposureUsd: getEffectiveMaxExposureUsd(configuredMaxExposureUsd),
    maxExposurePercentOfEquity: (() => {
      const v = process.env.MAX_EXPOSURE_PCT_OF_EQUITY?.trim();
      if (!v) return null;
      const pct = parseFloat(v);
      return Number.isFinite(pct) && pct > 0 ? pct : null;
    })(),
    minSlDistancePercent: parseFloat(process.env.MIN_SL_DISTANCE_PERCENT || '0.004'),
  };
}

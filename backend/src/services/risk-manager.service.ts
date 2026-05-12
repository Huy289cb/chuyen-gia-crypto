/**
 * Risk Manager Service
 * Hard gate for trade execution - prevents account death
 * Controls whether a trade is allowed at all
 */

import { getRiskPolicy, RiskPolicyConfig } from '../config/risk-policy';

export interface TradeRequest {
  symbol: string;
  grade: 'A' | 'B' | 'C' | 'D';
  confidence: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  accountBalance: number;
  currentSpread?: number;
  volatility?: number;
  openPositions?: number;
  symbolPositions?: number;
}

export interface RiskCheckResult {
  allowed: boolean;
  reason: string;
  positionSize?: number;
  riskAmount?: number;
}

export interface DailyStats {
  dailyPnL: number;
  consecutiveLosses: number;
  lastLossTime?: number;
}

export interface ExecutionCost {
  spreadPercent: number;
  estimatedSlippagePercent: number;
  feePercent: number;
  totalCostPercent: number;
}

/**
 * Risk Manager Service
 */
export class RiskManagerService {
  private config: RiskPolicyConfig;
  private dailyStats: Map<string, DailyStats> = new Map();

  constructor(config?: RiskPolicyConfig) {
    this.config = config || getRiskPolicy();
  }

  /**
   * Check if a trade can be opened
   * This is the main gate - all conditions must pass
   */
  canOpenTrade(request: TradeRequest, stats?: DailyStats): RiskCheckResult {
    // Check signal quality
    const signalCheck = this.checkSignalQuality(request);
    if (!signalCheck.allowed) {
      return signalCheck;
    }

    // Check daily loss limit
    if (stats) {
      const dailyLossCheck = this.checkDailyLossLimit(request.accountBalance, stats);
      if (!dailyLossCheck.allowed) {
        return dailyLossCheck;
      }

      // Check consecutive losses
      const consecutiveCheck = this.checkConsecutiveLosses(stats);
      if (!consecutiveCheck.allowed) {
        return consecutiveCheck;
      }
    }

    // Check execution costs
    const costCheck = this.applyExecutionCostFilter(request);
    if (!costCheck.allowed) {
      return costCheck;
    }

    // Check position limits
    const positionCheck = this.checkPositionLimits(request);
    if (!positionCheck.allowed) {
      return positionCheck;
    }

    // Calculate position size
    const positionSize = this.calculatePositionSize(request);

    return {
      allowed: true,
      reason: 'All risk checks passed',
      positionSize,
      riskAmount: request.accountBalance * (this.config.riskPerTradePercent / 100)
    };
  }

  /**
   * Check signal quality requirements
   */
  private checkSignalQuality(request: TradeRequest): RiskCheckResult {
    const gradeOrder = ['A', 'B', 'C', 'D'];
    const minIndex = gradeOrder.indexOf(this.config.minSignalGrade);
    const gradeIndex = gradeOrder.indexOf(request.grade);

    if (gradeIndex > minIndex) {
      return {
        allowed: false,
        reason: `Signal grade ${request.grade} below minimum ${this.config.minSignalGrade}`
      };
    }

    if (request.confidence < this.config.minSignalConfidence) {
      return {
        allowed: false,
        reason: `Confidence ${(request.confidence * 100).toFixed(0)}% below minimum ${(this.config.minSignalConfidence * 100).toFixed(0)}%`
      };
    }

    return { allowed: true, reason: 'Signal quality acceptable' };
  }

  /**
   * Check daily loss limit
   */
  checkDailyLossLimit(accountBalance: number, stats: DailyStats): RiskCheckResult {
    const dailyLossPercent = (Math.abs(stats.dailyPnL) / accountBalance) * 100;

    if (stats.dailyPnL < 0 && dailyLossPercent >= this.config.dailyLossLimitPercent) {
      return {
        allowed: false,
        reason: `Daily loss ${(dailyLossPercent).toFixed(2)}% reached limit of ${this.config.dailyLossLimitPercent}%`
      };
    }

    return { allowed: true, reason: 'Daily loss limit not reached' };
  }

  /**
   * Check consecutive losses
   */
  checkConsecutiveLosses(stats: DailyStats): RiskCheckResult {
    if (stats.consecutiveLosses >= this.config.maxConsecutiveLosses) {
      // Check if cooldown period has passed
      if (stats.lastLossTime) {
        const hoursSinceLoss = (Date.now() - stats.lastLossTime) / (1000 * 60 * 60);
        if (hoursSinceLoss < this.config.consecutiveLossCooldownHours) {
          const remainingHours = this.config.consecutiveLossCooldownHours - hoursSinceLoss;
          return {
            allowed: false,
            reason: `${stats.consecutiveLosses} consecutive losses - cooldown active (${remainingHours.toFixed(1)}h remaining)`
          };
        }
      }
    }

    return { allowed: true, reason: 'Consecutive losses within limits' };
  }

  /**
   * Apply execution cost filters
   */
  applyExecutionCostFilter(request: TradeRequest): RiskCheckResult {
    const costs = this.estimateExecutionCosts(request);

    if (costs.spreadPercent > this.config.maxSpreadPercent) {
      return {
        allowed: false,
        reason: `Spread ${(costs.spreadPercent).toFixed(3)}% exceeds limit ${this.config.maxSpreadPercent}%`
      };
    }

    if (costs.totalCostPercent > (this.config.maxSpreadPercent + this.config.maxSlippagePercent + this.config.maxFeePercent)) {
      return {
        allowed: false,
        reason: `Total execution cost ${(costs.totalCostPercent).toFixed(3)}% exceeds limit`
      };
    }

    return { allowed: true, reason: 'Execution costs acceptable' };
  }

  /**
   * Estimate execution costs
   */
  private estimateExecutionCosts(request: TradeRequest): ExecutionCost {
    const spreadPercent = request.currentSpread 
      ? (request.currentSpread / request.entryPrice) * 100 
      : 0.02; // Default 0.02%

    const estimatedSlippagePercent = this.config.maxSlippagePercent * 0.5; // Conservative estimate
    const feePercent = this.config.maxFeePercent; // Binance futures fee ~0.02-0.04%

    return {
      spreadPercent,
      estimatedSlippagePercent,
      feePercent,
      totalCostPercent: spreadPercent + estimatedSlippagePercent + feePercent
    };
  }

  /**
   * Check position limits
   */
  private checkPositionLimits(request: TradeRequest): RiskCheckResult {
    if (request.symbolPositions && request.symbolPositions >= this.config.maxPositionsPerSymbol) {
      return {
        allowed: false,
        reason: `Max positions per symbol (${this.config.maxPositionsPerSymbol}) reached`
      };
    }

    if (request.openPositions && request.openPositions >= this.config.maxTotalPositions) {
      return {
        allowed: false,
        reason: `Max total positions (${this.config.maxTotalPositions}) reached`
      };
    }

    return { allowed: true, reason: 'Position limits not reached' };
  }

  /**
   * Calculate position size based on risk and volatility
   */
  calculatePositionSize(request: TradeRequest): number {
    const riskAmount = request.accountBalance * (this.config.riskPerTradePercent / 100);
    const stopLossDistance = Math.abs(request.entryPrice - request.stopLoss);

    // Base position size from risk
    let positionSize = stopLossDistance > 0 ? riskAmount / stopLossDistance : 0;

    // Adjust for volatility
    if (request.volatility && request.volatility > this.config.highVolatilityThreshold) {
      positionSize = positionSize * this.config.volatilityMultiplier;
    }

    // Ensure position size is positive
    return Math.max(0, positionSize);
  }

  /**
   * Update daily stats
   */
  updateDailyStats(symbol: string, pnl: number, isLoss: boolean): void {
    const stats = this.dailyStats.get(symbol) || {
      dailyPnL: 0,
      consecutiveLosses: 0
    };

    stats.dailyPnL += pnl;

    if (isLoss) {
      stats.consecutiveLosses += 1;
      stats.lastLossTime = Date.now();
    } else {
      stats.consecutiveLosses = 0;
    }

    this.dailyStats.set(symbol, stats);
  }

  /**
   * Get daily stats for a symbol
   */
  getDailyStats(symbol: string): DailyStats | undefined {
    return this.dailyStats.get(symbol);
  }

  /**
   * Reset daily stats (call at start of new day)
   */
  resetDailyStats(symbol?: string): void {
    if (symbol) {
      this.dailyStats.delete(symbol);
    } else {
      this.dailyStats.clear();
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RiskPolicyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): RiskPolicyConfig {
    return { ...this.config };
  }
}

// Export singleton instance
export const riskManagerService = new RiskManagerService();

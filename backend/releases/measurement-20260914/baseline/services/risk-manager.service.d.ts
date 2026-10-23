/**
 * Risk Manager Service
 * Hard gate for trade execution - prevents account death
 * Controls whether a trade is allowed at all
 */
import { RiskPolicyConfig } from '../config/risk-policy';
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
export declare class RiskManagerService {
    private config;
    private dailyStats;
    constructor(config?: RiskPolicyConfig);
    /**
     * Check if a trade can be opened
     * This is the main gate - all conditions must pass
     */
    canOpenTrade(request: TradeRequest, stats?: DailyStats): RiskCheckResult;
    /**
     * Check signal quality requirements
     */
    private checkSignalQuality;
    /**
     * Check daily loss limit
     */
    checkDailyLossLimit(accountBalance: number, stats: DailyStats): RiskCheckResult;
    /**
     * Check consecutive losses
     */
    checkConsecutiveLosses(stats: DailyStats): RiskCheckResult;
    /**
     * Apply execution cost filters
     */
    applyExecutionCostFilter(request: TradeRequest): RiskCheckResult;
    /**
     * Estimate execution costs
     */
    private estimateExecutionCosts;
    /**
     * Check position limits
     */
    private checkPositionLimits;
    /**
     * Calculate position size based on risk and volatility
     */
    calculatePositionSize(request: TradeRequest): number;
    /**
     * Update daily stats
     */
    updateDailyStats(symbol: string, pnl: number, isLoss: boolean): void;
    /**
     * Get daily stats for a symbol
     */
    getDailyStats(symbol: string): DailyStats | undefined;
    /**
     * Reset daily stats (call at start of new day)
     */
    resetDailyStats(symbol?: string): void;
    /**
     * Update configuration
     */
    updateConfig(config: Partial<RiskPolicyConfig>): void;
    /**
     * Get current configuration
     */
    getConfig(): RiskPolicyConfig;
}
export declare const riskManagerService: RiskManagerService;
//# sourceMappingURL=risk-manager.service.d.ts.map
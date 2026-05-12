/**
 * Metrics Routes
 * Provides endpoints for risk, playbooks, no-trade reasons, and execution costs
 */

import { Router, Request, Response } from 'express';
import { riskManagerService } from '../services/risk-manager.service';
import { memoryService } from '../services/memory.service';
import { signalGateService } from '../services/signal-gate.service';

const router = Router();

/**
 * GET /api/metrics/risk
 * Get current risk state and statistics
 */
router.get('/risk', async (_req: Request, res: Response) => {
  try {
    const config = riskManagerService.getConfig();
    const dailyStats = riskManagerService.getDailyStats('BTC'); // Default to BTC
    
    res.json({
      config: {
        risk_per_trade_percent: config.riskPerTradePercent,
        daily_loss_limit_percent: config.dailyLossLimitPercent,
        max_consecutive_losses: config.maxConsecutiveLosses,
        consecutive_loss_cooldown_hours: config.consecutiveLossCooldownHours,
        max_spread_percent: config.maxSpreadPercent,
        max_slippage_percent: config.maxSlippagePercent,
        max_fee_percent: config.maxFeePercent,
        min_signal_grade: config.minSignalGrade,
        min_signal_confidence: config.minSignalConfidence,
        max_positions_per_symbol: config.maxPositionsPerSymbol,
        max_total_positions: config.maxTotalPositions
      },
      daily_stats: dailyStats || {
        dailyPnL: 0,
        consecutiveLosses: 0
      },
      trading_allowed: dailyStats ? dailyStats.dailyPnL > -config.dailyLossLimitPercent : true,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[Metrics] Error getting risk metrics:', error.message);
    res.status(500).json({ error: 'Failed to get risk metrics' });
  }
});

/**
 * GET /api/metrics/playbooks
 * Get playbook performance statistics
 */
router.get('/playbooks', async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string) || 'BTC';
    const performance = await memoryService.getPlaybookPerformance(symbol);
    
    res.json({
      symbol,
      playbooks: performance,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[Metrics] Error getting playbook metrics:', error.message);
    res.status(500).json({ error: 'Failed to get playbook metrics' });
  }
});

/**
 * GET /api/metrics/no-trade
 * Get recent no-trade decisions and reasons
 */
router.get('/no-trade', async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string) || 'BTC';
    // const limit = parseInt((req.query.limit as string) || '20');
    
    // Get recent no-trade decisions from memory
    // This will query the trade_decisions table where decision = 'no_trade'
    // For now, return placeholder data
    res.json({
      symbol,
      no_trade_decisions: [],
      total_count: 0,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[Metrics] Error getting no-trade metrics:', error.message);
    res.status(500).json({ error: 'Failed to get no-trade metrics' });
  }
});

/**
 * GET /api/metrics/costs
 * Get execution cost statistics
 */
router.get('/costs', async (_req: Request, res: Response) => {
  try {
    const config = riskManagerService.getConfig();
    
    // Return cost limits and recent cost data
    // This will query execution_costs table when implemented
    res.json({
      limits: {
        max_spread_percent: config.maxSpreadPercent,
        max_slippage_percent: config.maxSlippagePercent,
        max_fee_percent: config.maxFeePercent,
        max_total_cost_percent: config.maxSpreadPercent + config.maxSlippagePercent + config.maxFeePercent
      },
      recent_costs: [],
      total_trades: 0,
      avg_cost_percent: 0,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[Metrics] Error getting cost metrics:', error.message);
    res.status(500).json({ error: 'Failed to get cost metrics' });
  }
});

/**
 * GET /api/metrics/signal-gate
 * Get signal gate statistics
 */
router.get('/signal-gate', async (req: Request, res: Response) => {
  try {
    const config = signalGateService.getConfig();
    
    res.json({
      config: {
        min_grade: config.minGrade,
        min_confidence: config.minConfidence,
        allowed_regimes: config.allowedRegimes,
        enable_duplicate_filter: config.enableDuplicateFilter
      },
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[Metrics] Error getting signal gate metrics:', error.message);
    res.status(500).json({ error: 'Failed to get signal gate metrics' });
  }
});

export default router;

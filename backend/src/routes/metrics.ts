/**
 * Metrics Routes
 * Provides endpoints for risk, playbooks, no-trade reasons, and execution costs
 */

import { Router, Request, Response } from 'express';
import { riskManagerService } from '../services/risk-manager.service';
import { memoryService } from '../services/memory.service';
import { signalGateService } from '../services/signal-gate.service';
import { prisma } from '../lib/prisma';
import { getRiskPolicy } from '../config/risk-policy';
import { getAccountCircuitStatus } from '../services/account-circuit.service';
import {
  profitFactorLabel,
  rollupExpectancyFromOutcomes,
} from '../services/expectancy-rollup.service';

const router = Router();

/**
 * GET /api/metrics/risk
 * Get current risk state and statistics
 */
router.get('/risk', async (_req: Request, res: Response) => {
  try {
    const config = riskManagerService.getConfig();
    const policy = getRiskPolicy();
    const account = await prisma.testnetAccount.findFirst({
      where: { symbol: 'BTC', method_id: 'kim_nghia' },
    });
    const circuit = account ? await getAccountCircuitStatus(account.id) : null;

    res.json({
      config: {
        risk_per_trade_percent: config.riskPerTradePercent,
        daily_loss_limit_percent: policy.dailyLossLimitPercent,
        max_drawdown_percent: policy.maxDrawdownPercent,
        max_consecutive_losses: config.maxConsecutiveLosses,
        consecutive_loss_cooldown_hours: config.consecutiveLossCooldownHours,
        max_spread_percent: config.maxSpreadPercent,
        max_slippage_percent: config.maxSlippagePercent,
        max_fee_percent: config.maxFeePercent,
        min_signal_grade: config.minSignalGrade,
        min_signal_confidence: config.minSignalConfidence,
        max_positions_per_symbol: config.maxPositionsPerSymbol,
        max_total_positions: config.maxTotalPositions,
        circuit_daily_loss_enabled: policy.circuitDailyLossEnabled,
        circuit_drawdown_enabled: policy.circuitDrawdownEnabled,
        circuit_expectancy_kill_enabled: policy.circuitExpectancyKillEnabled,
        circuit_expectancy_window: policy.circuitExpectancyWindow,
        circuit_expectancy_min_sum_r: policy.circuitExpectancyMinSumR,
      },
      circuit: circuit
        ? {
            allowed: circuit.allowed,
            reason: circuit.reason,
            daily_loss_usd: circuit.dailyLossUsd,
            daily_loss_percent: circuit.dailyLossPercent,
            drawdown_percent: circuit.drawdownPercent,
            peak_equity: circuit.peakEquity,
            expectancy: circuit.expectancy,
          }
        : null,
      trading_allowed: circuit ? circuit.allowed : true,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[Metrics] Error getting risk metrics:', error.message);
    res.status(500).json({ error: 'Failed to get risk metrics' });
  }
});

/**
 * GET /api/metrics/expectancy?n=20&days=
 * Rollup avgR / PF / n from trade_outcomes.
 */
router.get('/expectancy', async (req: Request, res: Response) => {
  try {
    const n = Math.min(200, Math.max(1, parseInt(String(req.query.n || '20'), 10) || 20));
    const days = parseFloat(String(req.query.days || '0')) || 0;
    const where =
      days > 0
        ? { timestamp: { gte: new Date(Date.now() - days * 86_400_000) } }
        : {};
    const rows = await prisma.tradeOutcome.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: days > 0 ? 500 : n,
      select: { realized_rr: true, realized_pnl: true, close_reason: true, timestamp: true },
    });
    const window = days > 0 ? rows : rows.slice(0, n);
    const rollup = rollupExpectancyFromOutcomes(window);
    const policy = getRiskPolicy();
    res.json({
      window: days > 0 ? `last_${days}d` : `last_${n}`,
      ...rollup,
      profit_factor_label: profitFactorLabel(rollup.profitFactor, rollup.wins, rollup.losses),
      kill_armed:
        rollup.n >= policy.circuitExpectancyWindow &&
        rollup.sumR <= policy.circuitExpectancyMinSumR,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[Metrics] Error getting expectancy:', error.message);
    res.status(500).json({ error: 'Failed to get expectancy' });
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
router.get('/signal-gate', async (_req: Request, res: Response) => {
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

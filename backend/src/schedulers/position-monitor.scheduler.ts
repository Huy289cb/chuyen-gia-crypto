/**
 * Position Monitor Scheduler
 * Monitors open positions and applies HOLD / REDUCE / EXIT actions
 * Simplified position management based on health and market conditions
 */

import cron, { type ScheduledTask } from 'node-cron';
import { prisma } from '../lib/prisma';

let positionMonitorTask: ScheduledTask | null = null;
let isRunning = false;

export interface PositionHealth {
  position_id: string;
  symbol: string;
  side: string;
  entry_price: number;
  current_price: number;
  unrealized_pnl: number;
  unrealized_pnl_percent: number;
  time_in_position_minutes: number;
  health: 'healthy' | 'warning' | 'critical';
  recommended_action: 'hold' | 'reduce' | 'exit';
  reason: string;
}

/**
 * Run position monitor
 */
async function runPositionMonitor() {
  if (isRunning) {
    console.warn('[PositionMonitor] Previous monitor still running, skipping cycle');
    return;
  }

  isRunning = true;
  try {
    console.log('[PositionMonitor] Starting position monitor');

    // Get open testnet positions
    const openPositions = await prisma.testnetPosition.findMany({
      where: { status: 'open' },
      include: {
        account: true
      }
    });

    console.log(`[PositionMonitor] Found ${openPositions.length} open positions`);

    for (const position of openPositions) {
      const health = await analyzePositionHealth(position);
      
      console.log(`[PositionMonitor] ${position.symbol} ${position.side}: ${health.health.toUpperCase()}`);
      console.log(`[PositionMonitor] PnL: ${health.unrealized_pnl.toFixed(2)} (${health.unrealized_pnl_percent.toFixed(2)}%), Action: ${health.recommended_action}`);
      console.log(`[PositionMonitor] Reason: ${health.reason}`);

      // Execute recommended action (will be implemented in integration phase)
      if (health.recommended_action !== 'hold') {
        console.log(`[PositionMonitor] Would execute ${health.recommended_action} for position ${position.position_id}`);
      }
    }

    console.log('[PositionMonitor] Position monitor completed');
  } catch (error) {
    console.error('[PositionMonitor] Error during position monitor:', error);
  } finally {
    isRunning = false;
  }
}

/**
 * Analyze position health
 */
async function analyzePositionHealth(position: any): Promise<PositionHealth> {
  const currentPrice = position.current_price;
  const entryPrice = position.entry_price;
  const side = position.side;
  
  // Calculate PnL
  let unrealizedPnl = 0;
  let unrealizedPnlPercent = 0;
  
  if (side === 'long') {
    unrealizedPnl = (currentPrice - entryPrice) * position.size_qty;
    unrealizedPnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
  } else {
    unrealizedPnl = (entryPrice - currentPrice) * position.size_qty;
    unrealizedPnlPercent = ((entryPrice - currentPrice) / entryPrice) * 100;
  }

  // Calculate time in position
  const entryTime = new Date(position.entry_time);
  const now = new Date();
  const timeInPositionMinutes = (now.getTime() - entryTime.getTime()) / (1000 * 60);

  // Determine health and action
  let health: 'healthy' | 'warning' | 'critical' = 'healthy';
  let recommendedAction: 'hold' | 'reduce' | 'exit' = 'hold';
  let reason = 'Position is healthy';

  // Check if near SL
  const slDistance = side === 'long' 
    ? (currentPrice - position.stop_loss) / entryPrice * 100
    : (position.stop_loss - currentPrice) / entryPrice * 100;

  if (slDistance < 0.2) {
    health = 'critical';
    recommendedAction = 'exit';
    reason = 'Position near stop loss';
  } else if (slDistance < 0.5) {
    health = 'warning';
    recommendedAction = 'reduce';
    reason = 'Position approaching stop loss';
  }

  // Check if in profit for extended time
  if (unrealizedPnlPercent > 1.0 && timeInPositionMinutes > 60) {
    health = 'healthy';
    recommendedAction = 'reduce';
    reason = 'Position in profit for extended time, consider taking partial profit';
  }

  // Check if losing for extended time
  if (unrealizedPnlPercent < -0.5 && timeInPositionMinutes > 120) {
    health = 'warning';
    recommendedAction = 'exit';
    reason = 'Position losing for extended time';
  }

  return {
    position_id: position.position_id,
    symbol: position.symbol,
    side: position.side,
    entry_price: position.entry_price,
    current_price: position.current_price,
    unrealized_pnl: unrealizedPnl,
    unrealized_pnl_percent: unrealizedPnlPercent,
    time_in_position_minutes: timeInPositionMinutes,
    health,
    recommended_action: recommendedAction,
    reason
  };
}

/**
 * Start position monitor scheduler
 */
export function startPositionMonitorScheduler(cronExpression: string = '*/1 * * * *') {
  if (positionMonitorTask) {
    console.warn('[PositionMonitor] Scheduler already running');
    return;
  }

  console.log(`[PositionMonitor] Starting scheduler with cron: ${cronExpression}`);
  positionMonitorTask = cron.schedule(cronExpression, runPositionMonitor);
  
  // Run immediately on start
  runPositionMonitor();
}

/**
 * Stop position monitor scheduler
 */
export function stopPositionMonitorScheduler() {
  if (positionMonitorTask) {
    positionMonitorTask.stop();
    positionMonitorTask = null;
    console.log('[PositionMonitor] Scheduler stopped');
  }
}

/**
 * Run position monitor manually (for testing)
 */
export async function runManualPositionMonitor() {
  return await runPositionMonitor();
}

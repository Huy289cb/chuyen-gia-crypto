/**
 * Position Monitor Scheduler
 * Monitors open positions and applies HOLD / REDUCE / EXIT actions
 */

import cron, { type ScheduledTask } from 'node-cron';
import { prisma } from '../lib/prisma';
import { updateTestnetPosition } from '../repositories/testnet.repository';
import { resolveMarkPrice } from '../services/position-mark';
import {
  closeLocalPosition,
  closePositionOnBinanceMarket,
} from '../services/position-close.service';
import { recordSchedulerRun } from '../utils/scheduler-heartbeat';

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

async function runPositionMonitor() {
  if (isRunning) {
    console.warn('[PositionMonitor] Previous monitor still running, skipping cycle');
    return;
  }

  isRunning = true;
  recordSchedulerRun('PositionMonitor');
  try {
    console.log('[PositionMonitor] Starting position monitor');

    const openPositions = await prisma.testnetPosition.findMany({
      where: { status: 'open' },
      include: { account: true },
    });

    console.log(`[PositionMonitor] Found ${openPositions.length} open positions`);

    for (const position of openPositions) {
      const mark = await resolveMarkPrice(
        position.symbol,
        position.current_price || position.entry_price
      );
      await updateTestnetPosition(position.position_id, { current_price: mark });

      const refreshed = { ...position, current_price: mark };
      const health = await analyzePositionHealth(refreshed);

      console.log(
        `[PositionMonitor] ${position.symbol} ${position.side}: ${health.health.toUpperCase()}`
      );
      console.log(
        `[PositionMonitor] PnL: ${health.unrealized_pnl.toFixed(2)} (${health.unrealized_pnl_percent.toFixed(2)}%), Action: ${health.recommended_action}`
      );
      console.log(`[PositionMonitor] Reason: ${health.reason}`);

      if (health.recommended_action === 'exit') {
        await closePositionOnBinanceMarket(refreshed);
        await closeLocalPosition(
          { ...refreshed, account: refreshed.account },
          mark,
          'position_monitor_exit'
        );
      } else if (health.recommended_action === 'reduce') {
        const totalQty = Math.abs(refreshed.size_qty);
        const reduceQty = totalQty * 0.5;
        if (reduceQty > 0) {
          await closePositionOnBinanceMarket(refreshed, reduceQty);
          const remainingQty = totalQty - reduceQty;
          const sizeUsd =
            refreshed.size_usd > 0
              ? (refreshed.size_usd * remainingQty) / totalQty
              : remainingQty * mark;
          await updateTestnetPosition(position.position_id, {
            size_qty: remainingQty,
            size_usd: sizeUsd,
            current_price: mark,
          });
          console.log(
            `[PositionMonitor] Reduced ${position.position_id} by 50% (qty ${remainingQty})`
          );
        }
      }
    }

    console.log('[PositionMonitor] Position monitor completed');
  } catch (error) {
    console.error('[PositionMonitor] Error during position monitor:', error);
  } finally {
    isRunning = false;
  }
}

async function analyzePositionHealth(position: any): Promise<PositionHealth> {
  const currentPrice = position.current_price;
  const entryPrice = position.entry_price;
  const side = position.side;
  const qty = Math.abs(position.size_qty);

  let unrealizedPnl = 0;
  let unrealizedPnlPercent = 0;

  if (side === 'long') {
    unrealizedPnl = (currentPrice - entryPrice) * qty;
    unrealizedPnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
  } else {
    unrealizedPnl = (entryPrice - currentPrice) * qty;
    unrealizedPnlPercent = ((entryPrice - currentPrice) / entryPrice) * 100;
  }

  const entryTime = new Date(position.entry_time);
  const now = new Date();
  const timeInPositionMinutes = (now.getTime() - entryTime.getTime()) / (1000 * 60);

  let health: 'healthy' | 'warning' | 'critical' = 'healthy';
  let recommendedAction: 'hold' | 'reduce' | 'exit' = 'hold';
  let reason = 'Position is healthy';

  const slDistance =
    side === 'long'
      ? ((currentPrice - position.stop_loss) / entryPrice) * 100
      : ((position.stop_loss - currentPrice) / entryPrice) * 100;

  if (slDistance < 0.2) {
    health = 'critical';
    recommendedAction = 'exit';
    reason = 'Position near stop loss';
  } else if (slDistance < 0.5) {
    health = 'warning';
    recommendedAction = 'reduce';
    reason = 'Position approaching stop loss';
  }

  if (unrealizedPnlPercent > 1.0 && timeInPositionMinutes > 60) {
    health = 'healthy';
    recommendedAction = 'reduce';
    reason = 'Position in profit for extended time, consider taking partial profit';
  }

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
    reason,
  };
}

export function startPositionMonitorScheduler(cronExpression: string = '*/1 * * * *') {
  if (positionMonitorTask) {
    console.warn('[PositionMonitor] Scheduler already running');
    return;
  }

  console.log(`[PositionMonitor] Starting scheduler with cron: ${cronExpression}`);
  positionMonitorTask = cron.schedule(cronExpression, runPositionMonitor);
  runPositionMonitor();
}

export function stopPositionMonitorScheduler() {
  if (positionMonitorTask) {
    positionMonitorTask.stop();
    positionMonitorTask = null;
    console.log('[PositionMonitor] Scheduler stopped');
  }
}

export async function runManualPositionMonitor() {
  return await runPositionMonitor();
}

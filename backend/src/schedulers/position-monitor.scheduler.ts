/**
 * Position Monitor Scheduler
 * Monitors open positions — conservative: prefer exchange SL/TP, max one reduce.
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
import {
  notePositionMarkPersisted,
  shouldPersistPositionMark,
} from '../utils/position-mark-persist';
import { hookPositionMonitorAction } from '../services/telegram/telegram-hooks';
import { PIPELINE_EVENT_POSITION_ID } from '../repositories/testnet.repository';
import {
  analyzePositionHealth,
  type PositionData,
} from '../analyzers/position-health.analyzer';
import { syncTestnetAccountFromBinance } from '../services/binance-balance-sync.service';
import {
  deferToExchangeSlTp,
  getMinMinutesBeforeMonitorAction,
  getMinPnlPercentForMonitorAction,
  getPrecisionSkipMs,
  isPositionMonitorExitEnabled,
  isPositionMonitorReduceEnabled,
} from '../config/position-monitor-policy';

let positionMonitorTask: ScheduledTask | null = null;
let isRunning = false;

/** Avoid spamming Binance when reduce/close qty cannot be normalized. */
const precisionSkipUntil = new Map<string, number>();

const REDUCE_FRACTION = 0.5;

function isPositionMonitorEnabled(): boolean {
  return process.env.POSITION_MONITOR_ENABLED !== 'false';
}

function shouldSkipPrecisionAction(positionId: string): boolean {
  const until = precisionSkipUntil.get(positionId);
  return until != null && Date.now() < until;
}

function markPrecisionSkip(positionId: string, reason: string): void {
  const ms = getPrecisionSkipMs();
  precisionSkipUntil.set(positionId, Date.now() + ms);
  console.warn(
    `[PositionMonitor] Skipping reduce/close for ${positionId} for ${Math.round(ms / 60000)}m: ${reason}`
  );
}

/** At most one monitor-driven reduce per position. */
function canReduceAgain(position: { partial_closed: number }): boolean {
  return (position.partial_closed ?? 0) < 0.01;
}

function hasExchangeSlTp(position: {
  binance_sl_order_id?: string | null;
  binance_tp_order_id?: string | null;
}): boolean {
  return Boolean(position.binance_sl_order_id && position.binance_tp_order_id);
}

function toPositionData(position: {
  position_id: string;
  symbol: string;
  side: string;
  entry_price: number;
  current_price: number;
  stop_loss: number;
  take_profit: number;
  entry_time: Date;
  size_qty: number;
  unrealized_pnl: number;
}): PositionData {
  const side = position.side.toLowerCase() === 'short' ? 'short' : 'long';
  return {
    position_id: position.position_id,
    symbol: position.symbol,
    side,
    entry_price: position.entry_price,
    current_price: position.current_price,
    stop_loss: position.stop_loss,
    take_profit: position.take_profit,
    entry_time: position.entry_time,
    size_qty: position.size_qty,
    unrealized_pnl: position.unrealized_pnl,
  };
}

async function runPositionMonitor() {
  if (!isPositionMonitorEnabled()) {
    return;
  }

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
      if (
        position.position_id === PIPELINE_EVENT_POSITION_ID ||
        String(position.side).toUpperCase() === 'NONE'
      ) {
        continue;
      }

      const mark = await resolveMarkPrice(
        position.symbol,
        position.current_price || position.entry_price
      );

      const storedMark = position.current_price || position.entry_price;
      const qty = Math.abs(position.size_qty);
      let markUnrealized = 0;
      if (position.side === 'long') {
        markUnrealized = (mark - position.entry_price) * qty;
      } else {
        markUnrealized = (position.entry_price - mark) * qty;
      }

      let refreshed = position;
      if (
        shouldPersistPositionMark(
          position.position_id,
          mark,
          storedMark,
          markUnrealized,
          position.unrealized_pnl || 0
        )
      ) {
        await updateTestnetPosition(position.position_id, {
          current_price: mark,
          unrealized_pnl: markUnrealized,
        });
        notePositionMarkPersisted(position.position_id);
        const row = await prisma.testnetPosition.findUnique({
          where: { position_id: position.position_id },
          include: { account: true },
        });
        if (!row || row.status !== 'open') continue;
        refreshed = row;
      } else {
        refreshed = { ...position, current_price: mark, unrealized_pnl: markUnrealized };
      }

      if (refreshed.status !== 'open') continue;

      const exchangeActive =
        deferToExchangeSlTp() && hasExchangeSlTp(refreshed);

      const health = analyzePositionHealth(toPositionData(refreshed), {
        partial_closed: refreshed.partial_closed ?? 0,
        exchange_sl_tp_active: exchangeActive,
        min_minutes_before_action: getMinMinutesBeforeMonitorAction(),
        min_pnl_percent_for_action: getMinPnlPercentForMonitorAction(),
      });

      const unrealizedPnl = markUnrealized;

      console.log(
        `[PositionMonitor] ${position.symbol} ${position.side}: ${health.health.toUpperCase()}`
      );
      console.log(
        `[PositionMonitor] PnL: ${unrealizedPnl.toFixed(2)} (${health.pnl_percent.toFixed(2)}%), sl_progress: ${health.sl_progress != null ? (health.sl_progress * 100).toFixed(0) + '%' : 'n/a'}, Action: ${health.recommended_action}`
      );
      console.log(`[PositionMonitor] Reason: ${health.reason}`);

      if (health.recommended_action === 'exit') {
        if (!isPositionMonitorExitEnabled()) {
          console.log(
            `[PositionMonitor] EXIT skipped (POSITION_MONITOR_ALLOW_EXIT=false) for ${position.position_id}`
          );
          continue;
        }
        if (shouldSkipPrecisionAction(position.position_id)) {
          continue;
        }
        hookPositionMonitorAction(position.symbol, 'EXIT', health.reason);
        const closeResult = await closePositionOnBinanceMarket(refreshed);
        if (!closeResult.ok) {
          markPrecisionSkip(position.position_id, closeResult.reason ?? 'exit close failed');
          continue;
        }
        await closeLocalPosition(
          { ...refreshed, account: refreshed.account },
          mark,
          'position_monitor_exit'
        );
        if (process.env.BINANCE_ENABLED === 'true') {
          try {
            await syncTestnetAccountFromBinance(position.account_id);
          } catch (syncErr: unknown) {
            const msg = syncErr instanceof Error ? syncErr.message : String(syncErr);
            console.warn(`[PositionMonitor] Balance sync after exit failed: ${msg}`);
          }
        }
      } else if (health.recommended_action === 'reduce') {
        if (!isPositionMonitorReduceEnabled()) {
          console.log(
            `[PositionMonitor] REDUCE skipped (POSITION_MONITOR_ALLOW_REDUCE not true) for ${position.position_id}`
          );
          continue;
        }
        if (!canReduceAgain(refreshed)) {
          console.log(
            `[PositionMonitor] REDUCE skipped — already reduced (partial_closed=${refreshed.partial_closed}) for ${position.position_id}`
          );
          continue;
        }
        if (shouldSkipPrecisionAction(position.position_id)) {
          continue;
        }
        hookPositionMonitorAction(position.symbol, 'REDUCE', health.reason);
        const totalQty = Math.abs(refreshed.size_qty);
        const reduceQty = totalQty * REDUCE_FRACTION;
        if (reduceQty <= 0) {
          console.log(`[PositionMonitor] REDUCE skipped — qty too small for ${position.position_id}`);
          continue;
        }
        const closeResult = await closePositionOnBinanceMarket(refreshed, reduceQty);
        if (!closeResult.ok) {
          markPrecisionSkip(position.position_id, closeResult.reason ?? 'reduce close failed');
          continue;
        }
        const closedQty = closeResult.normalizedQty ?? reduceQty;
        const remainingQty = Math.max(0, totalQty - closedQty);
        const sizeUsd =
          refreshed.size_usd > 0
            ? (refreshed.size_usd * remainingQty) / totalQty
            : remainingQty * mark;
        await updateTestnetPosition(position.position_id, {
          size_qty: refreshed.side === 'short' ? -remainingQty : remainingQty,
          size_usd: sizeUsd,
          current_price: mark,
          partial_closed: 1,
        });
        console.log(
          `[PositionMonitor] Reduced ${position.position_id} once (remaining qty ${remainingQty}, partial_closed=1.00)`
        );
        if (process.env.BINANCE_ENABLED === 'true') {
          try {
            await syncTestnetAccountFromBinance(position.account_id);
          } catch (syncErr: unknown) {
            const msg = syncErr instanceof Error ? syncErr.message : String(syncErr);
            console.warn(`[PositionMonitor] Balance sync after reduce failed: ${msg}`);
          }
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

export function startPositionMonitorScheduler(cronExpression: string = '*/1 * * * *') {
  if (positionMonitorTask) {
    console.warn('[PositionMonitor] Scheduler already running');
    return;
  }

  console.log(
    `[PositionMonitor] Starting scheduler cron=${cronExpression} enabled=${isPositionMonitorEnabled()} ` +
      `allow_reduce=${isPositionMonitorReduceEnabled()} allow_exit=${isPositionMonitorExitEnabled()} ` +
      `defer_sl_tp=${deferToExchangeSlTp()}`
  );
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

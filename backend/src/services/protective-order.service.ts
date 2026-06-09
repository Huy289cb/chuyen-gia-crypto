/**
 * P1.6 — Protective orders: recompute SL/TP from actual fill, handle -2021, emergency close.
 */

import { computeSlProgress } from '../analyzers/position-health.analyzer';
import { getRiskPolicy } from '../config/risk-policy';
import { updateTestnetPosition, recordTestnetTradeEvent } from '../repositories/testnet.repository';
import { placeStopLossOrder, placeTakeProfitOrder } from './binanceClient';
import { ensurePositionModeDetected, getPositionMode } from './binance-hedge-mode';
import {
  closeLocalPosition,
  closePositionOnBinanceMarket,
} from './position-close.service';

export interface SlTpLevels {
  stop_loss: number;
  take_profit: number;
}

export function isOrderWouldTriggerImmediatelyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('-2021') || message.toLowerCase().includes('immediately trigger');
}

/**
 * Recompute SL/TP from fill price while preserving planned risk distance and R:R.
 */
export function recomputeSlTpFromFill(params: {
  side: 'long' | 'short';
  fillPrice: number;
  plannedEntry: number;
  plannedSl: number;
  plannedTp: number;
  markPrice?: number;
  minSlDistancePercent?: number;
}): SlTpLevels {
  const {
    side,
    fillPrice,
    plannedEntry,
    plannedSl,
    plannedTp,
    markPrice,
    minSlDistancePercent = getRiskPolicy().minSlDistancePercent,
  } = params;

  if (!Number.isFinite(fillPrice) || fillPrice <= 0) {
    return { stop_loss: plannedSl, take_profit: plannedTp };
  }

  const entry = Number.isFinite(plannedEntry) && plannedEntry > 0 ? plannedEntry : fillPrice;

  let stop_loss: number;
  let take_profit: number;

  if (side === 'short') {
    const riskDist = Math.max(plannedSl - entry, entry * minSlDistancePercent);
    const rewardDist = Math.max(entry - plannedTp, riskDist);
    stop_loss = fillPrice + riskDist;
    take_profit = fillPrice - rewardDist;
    if (markPrice != null && markPrice > 0 && stop_loss <= markPrice) {
      stop_loss = markPrice * (1 + minSlDistancePercent);
    }
  } else {
    const riskDist = Math.max(entry - plannedSl, entry * minSlDistancePercent);
    const rewardDist = Math.max(plannedTp - entry, riskDist);
    stop_loss = fillPrice - riskDist;
    take_profit = fillPrice + rewardDist;
    if (markPrice != null && markPrice > 0 && stop_loss >= markPrice) {
      stop_loss = markPrice * (1 - minSlDistancePercent);
    }
  }

  return { stop_loss, take_profit };
}

function slTpInvalidForMark(
  side: string,
  stop_loss: number,
  mark: number
): boolean {
  const s = side.toLowerCase();
  if (s === 'short') return stop_loss <= mark;
  return stop_loss >= mark;
}

function pairSymbol(symbol: string): string {
  return `${symbol.toUpperCase().replace(/USDT$/i, '')}USDT`;
}

export function extractOpenAlgoOrderIds(orders: unknown): Set<string> {
  const rows = Array.isArray(orders) ? orders : [];
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const o = row as { algoId?: string | number; orderId?: string | number };
    const id = String(o.algoId ?? o.orderId ?? '');
    if (id) ids.add(id);
  }
  return ids;
}

/** Fetch live algo order ids; empty set on failure (treat DB ids as stale). */
export async function fetchOpenAlgoOrderIds(symbol: string): Promise<Set<string>> {
  try {
    const { getOpenAlgoOrders } = await import('./binanceClient');
    const orders = await getOpenAlgoOrders({}, pairSymbol(symbol));
    return extractOpenAlgoOrderIds(orders);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[ProtectiveOrder] openAlgoOrders fetch failed for ${symbol}: ${msg}`);
    return new Set();
  }
}

/**
 * Clear DB SL/TP ids that no longer exist on Binance (e.g. after demo wallet reset).
 */
export async function reconcileStaleProtectiveOrderIds(position: {
  position_id: string;
  symbol: string;
  binance_sl_order_id?: string | null;
  binance_tp_order_id?: string | null;
}): Promise<{
  binance_sl_order_id: string | null;
  binance_tp_order_id: string | null;
  clearedSl: boolean;
  clearedTp: boolean;
}> {
  const slId = position.binance_sl_order_id ? String(position.binance_sl_order_id) : null;
  const tpId = position.binance_tp_order_id ? String(position.binance_tp_order_id) : null;

  if (!slId && !tpId) {
    return {
      binance_sl_order_id: null,
      binance_tp_order_id: null,
      clearedSl: false,
      clearedTp: false,
    };
  }

  const openIds = await fetchOpenAlgoOrderIds(position.symbol);
  let clearedSl = false;
  let clearedTp = false;
  let newSlId = slId;
  let newTpId = tpId;

  if (slId && !openIds.has(slId)) {
    clearedSl = true;
    newSlId = null;
  }
  if (tpId && !openIds.has(tpId)) {
    clearedTp = true;
    newTpId = null;
  }

  if (clearedSl || clearedTp) {
    await updateTestnetPosition(position.position_id, {
      ...(clearedSl ? { binance_sl_order_id: null } : {}),
      ...(clearedTp ? { binance_tp_order_id: null } : {}),
    });
    console.warn(
      `[ProtectiveOrder] Cleared stale algo ids for ${position.position_id}: ` +
        `sl=${clearedSl ? `${slId}→cleared` : 'ok'} tp=${clearedTp ? `${tpId}→cleared` : 'ok'} ` +
        `(openAlgos=${openIds.size})`
    );
  }

  return {
    binance_sl_order_id: newSlId,
    binance_tp_order_id: newTpId,
    clearedSl,
    clearedTp,
  };
}

async function placeSlTpOnBinance(
  positionId: string,
  symbol: string,
  positionSideLocal: string,
  executedQty: number,
  levels: SlTpLevels,
  opts?: { skipSl?: boolean; skipTp?: boolean }
): Promise<{ slId?: string; tpId?: string; slError?: string; tpError?: string }> {
  await ensurePositionModeDetected();

  const symbolUsdt = `${symbol.toUpperCase().replace(/USDT$/i, '')}USDT`;
  const closeSide = positionSideLocal === 'long' ? 'SELL' : 'BUY';
  const signedAmt = positionSideLocal === 'long' ? executedQty : -executedQty;
  const mode = getPositionMode();
  const currentPosition = {
    positionAmt: signedAmt,
    ...(mode === 'HEDGE'
      ? { positionSide: positionSideLocal === 'long' ? 'LONG' : 'SHORT' }
      : {}),
  };

  const client = {};
  let slId: string | undefined;
  let tpId: string | undefined;
  let slError: string | undefined;
  let tpError: string | undefined;

  if (!opts?.skipSl) {
  try {
    const slOrder = await placeStopLossOrder(
      client,
      symbolUsdt,
      closeSide,
      executedQty,
      levels.stop_loss,
      'CLOSE',
      currentPosition,
      null
    );
    slId = String(slOrder.orderId);
  } catch (error: unknown) {
    slError = error instanceof Error ? error.message : String(error);
  }
  }

  if (!opts?.skipTp) {
  try {
    const tpOrder = await placeTakeProfitOrder(
      client,
      symbolUsdt,
      closeSide,
      executedQty,
      levels.take_profit,
      'CLOSE',
      currentPosition,
      null
    );
    tpId = String(tpOrder.orderId);
  } catch (error: unknown) {
    tpError = error instanceof Error ? error.message : String(error);
  }
  }

  if (slId || tpId) {
    await updateTestnetPosition(positionId, {
      ...(slId ? { binance_sl_order_id: slId } : {}),
      ...(tpId ? { binance_tp_order_id: tpId } : {}),
      stop_loss: levels.stop_loss,
      take_profit: levels.take_profit,
    });
  }

  return { slId, tpId, slError, tpError };
}

/**
 * Place or repair SL/TP; market-close if SL cannot be placed safely.
 */
export async function placeProtectiveOrdersForPosition(position: {
  position_id: string;
  account_id?: number;
  symbol: string;
  side: string;
  entry_price: number;
  size_qty: number;
  stop_loss: number;
  take_profit: number;
  binance_sl_order_id?: string | null;
  binance_tp_order_id?: string | null;
  account?: { current_balance?: number };
}): Promise<'ok' | 'partial' | 'closed' | 'skipped'> {
  const reconciled = await reconcileStaleProtectiveOrderIds(position);
  position = {
    ...position,
    binance_sl_order_id: reconciled.binance_sl_order_id,
    binance_tp_order_id: reconciled.binance_tp_order_id,
  };

  if (position.binance_sl_order_id && position.binance_tp_order_id) {
    return 'skipped';
  }

  const qty = Math.abs(Number(position.size_qty));
  if (!Number.isFinite(qty) || qty <= 0) return 'skipped';

  const side = position.side.toLowerCase() === 'short' ? 'short' : 'long';
  let mark = 0;
  try {
    const { fetchBinanceNetPosition } = await import('./binance-exposure.service');
    const live = await fetchBinanceNetPosition(position.symbol);
    mark = live?.markPrice ?? 0;
  } catch {
    /* proceed */
  }

  let fillRef = position.entry_price;
  if (
    mark > 0 &&
    (slTpInvalidForMark(side, position.stop_loss, mark) ||
      slTpInvalidForMark(side, recomputeSlTpFromFill({
        side,
        fillPrice: position.entry_price,
        plannedEntry: position.entry_price,
        plannedSl: position.stop_loss,
        plannedTp: position.take_profit,
      }).stop_loss, mark))
  ) {
    fillRef = side === 'short' ? Math.max(position.entry_price, mark) : Math.min(position.entry_price, mark);
    console.warn(
      `[ProtectiveOrder] Recompute levels for ${position.position_id}: fillRef=${fillRef} mark=${mark} (SL was behind market)`
    );
  }

  const levels = recomputeSlTpFromFill({
    side,
    fillPrice: fillRef,
    plannedEntry: position.entry_price,
    plannedSl: position.stop_loss,
    plannedTp: position.take_profit,
    markPrice: mark > 0 ? mark : undefined,
  });

  if (mark > 0 && slTpInvalidForMark(side, levels.stop_loss, mark)) {
    const slProgress = computeSlProgress({
      position_id: position.position_id,
      symbol: position.symbol,
      side,
      entry_price: position.entry_price,
      current_price: mark,
      stop_loss: position.stop_loss,
      take_profit: position.take_profit,
      entry_time: new Date(),
      size_qty: qty,
      unrealized_pnl: 0,
    });
    if (slProgress != null && slProgress >= 1) {
      console.warn(
        `[ProtectiveOrder] ${position.position_id} sl_progress=${(slProgress * 100).toFixed(0)}% — ` +
          `SL=${levels.stop_loss} would trigger immediately at mark=${mark}, emergency market close`
      );
      const closed = await emergencyMarketCloseUnhedged(
        position,
        mark,
        'sl_would_trigger_immediately'
      );
      return closed ? 'closed' : 'partial';
    }
    console.warn(
      `[ProtectiveOrder] ${position.position_id} SL behind market (mark=${mark}, sl=${levels.stop_loss}) — will retry with buffer`
    );
  }

  const skipSl = Boolean(position.binance_sl_order_id);
  const skipTp = Boolean(position.binance_tp_order_id);

  let result = await placeSlTpOnBinance(
    position.position_id,
    position.symbol,
    position.side,
    qty,
    levels,
    { skipSl, skipTp }
  );

  if (
    !result.slId &&
    !skipSl &&
    result.slError &&
    isOrderWouldTriggerImmediatelyError(result.slError) &&
    mark > 0
  ) {
    const retryLevels = recomputeSlTpFromFill({
      side,
      fillPrice: mark,
      plannedEntry: position.entry_price,
      plannedSl: position.stop_loss,
      plannedTp: position.take_profit,
      markPrice: mark,
      minSlDistancePercent:
        getRiskPolicy().minSlDistancePercent +
        parseFloat(process.env.SL_PLACEMENT_MARK_BUFFER_PCT || '0.001'),
    });
    console.warn(
      `[ProtectiveOrder] SL -2021 for ${position.position_id}, retry SL=${retryLevels.stop_loss} (mark=${mark})`
    );
    result = await placeSlTpOnBinance(
      position.position_id,
      position.symbol,
      position.side,
      qty,
      retryLevels,
      { skipTp: Boolean(position.binance_tp_order_id) }
    );
    Object.assign(levels, retryLevels);
  }

  if (result.slId) {
    console.log(
      `[ProtectiveOrder] SL placed for ${position.position_id}: sl=${levels.stop_loss} id=${result.slId}` +
        (result.tpId ? ` tp=${levels.take_profit} id=${result.tpId}` : ' (TP pending/failed)')
    );
    return result.tpId ? 'ok' : 'partial';
  }

  console.error(
    `[ProtectiveOrder] SL failed for ${position.position_id}: ${result.slError ?? 'unknown'} — emergency market close`
  );

  const closed = await emergencyMarketCloseUnhedged(position, mark, result.slError);
  return closed ? 'closed' : 'partial';
}

export async function emergencyMarketCloseUnhedged(
  position: {
    position_id: string;
    account_id?: number;
    symbol: string;
    side: string;
    size_qty: number;
    entry_price: number;
    account?: { current_balance?: number };
  },
  closePrice: number,
  reason?: string
): Promise<boolean> {
  const mark =
    closePrice > 0 ? closePrice : position.entry_price;

  const closeResult = await closePositionOnBinanceMarket({
    symbol: position.symbol,
    side: position.side,
    size_qty: position.size_qty,
  });

  if (!closeResult.ok) {
    console.error(
      `[ProtectiveOrder] Emergency close failed for ${position.position_id}: ${closeResult.reason}`
    );
    await recordTestnetTradeEvent(position.position_id, 'protective_failed', {
      reason: reason ?? 'sl_placement_failed',
      close_error: closeResult.reason,
      timestamp: new Date().toISOString(),
    });
    return false;
  }

  const { prisma: db } = await import('../lib/prisma');
  const full = await db.testnetPosition.findUnique({
    where: { position_id: position.position_id },
    include: { account: true },
  });
  if (full?.status === 'open') {
    await closeLocalPosition(
      { ...full, account: full.account },
      mark,
      'protective_failed_market_close',
      { verified_binance_zero: true }
    );
  }

  await recordTestnetTradeEvent(position.position_id, 'protective_failed', {
    reason: reason ?? 'sl_placement_failed',
    action: 'market_close',
    close_price: mark,
    timestamp: new Date().toISOString(),
  });

  return true;
}

/** Levels for a new fill before DB insert. */
export function resolveLevelsForFill(
  side: string,
  fillPrice: number,
  plannedEntry: number,
  plannedSl: number,
  plannedTp: number,
  markPrice?: number
): SlTpLevels {
  const s = side.toLowerCase() === 'short' ? 'short' : 'long';
  return recomputeSlTpFromFill({
    side: s,
    fillPrice,
    plannedEntry,
    plannedSl: plannedSl,
    plannedTp: plannedTp,
    markPrice,
  });
}

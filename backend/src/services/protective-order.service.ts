import { isPastStopLoss, isPastTakeProfit, tpInvalidForMark, evaluateProtectiveAction, slTpInvalidForMark } from '../utils/protective-action';
import type { SlTpLevels } from '../utils/protective-action';
export { isPastStopLoss, isPastTakeProfit, tpInvalidForMark, evaluateProtectiveAction } from '../utils/protective-action';
export type { SlTpLevels, ProtectiveAction } from '../utils/protective-action';
/**
 * P1.6 — Protective orders: recompute SL/TP from actual fill, handle -2021, emergency close.
 */

import { getRiskPolicy } from '../config/risk-policy';
import { updateTestnetPosition, recordTestnetTradeEvent } from '../repositories/testnet.repository';
import { placeStopLossOrder, placeTakeProfitOrder } from './binanceClient';
import { ensurePositionModeDetected, getPositionMode } from './binance-hedge-mode';
import {
  closeLocalPosition,
  closePositionOnBinanceMarket,
} from './position-close.service';
import { notifyAlert } from './telegram/telegram-notify.service';





export type ProtectivePlacementOutcome = 'ok' | 'partial' | 'closed' | 'skipped';

const PROTECTIVE_RETRY_COOLDOWN_MS = 2 * 60_000;
const PROTECTIVE_MARK_MOVE_THRESHOLD = 0.005;

const protectiveRetryState = new Map<string, { failedAt: number; markAtFail: number }>();







/**
 * Decide protective action from planned/recomputed levels vs current mark.
 */


function shouldSkipProtectiveRetry(positionId: string, mark: number): boolean {
  const state = protectiveRetryState.get(positionId);
  if (!state) return false;
  if (Date.now() - state.failedAt >= PROTECTIVE_RETRY_COOLDOWN_MS) return false;
  if (state.markAtFail <= 0 || mark <= 0) return true;
  const move = Math.abs(mark - state.markAtFail) / state.markAtFail;
  return move < PROTECTIVE_MARK_MOVE_THRESHOLD;
}

function recordProtectiveFailure(positionId: string, mark: number): void {
  protectiveRetryState.set(positionId, { failedAt: Date.now(), markAtFail: mark });
}

function clearProtectiveRetryState(positionId: string): void {
  protectiveRetryState.delete(positionId);
}

function notifyProtectiveAction(
  position: { position_id: string; symbol: string; side: string },
  title: string,
  detail: string
): void {
  notifyAlert(
    title,
    `${position.symbol} ${position.side} ${position.position_id}: ${detail}`,
    `protective:${position.position_id}:${title}`
  );
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

/** An unavailable order list must never be interpreted as canceled protection. */
export async function fetchOpenAlgoOrderIds(symbol: string): Promise<Set<string>> {
  try {
    const { getOpenAlgoOrders } = await import('./binanceClient');
    const orders = await getOpenAlgoOrders({}, pairSymbol(symbol));
    return extractOpenAlgoOrderIds(orders);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[ProtectiveOrder] openAlgoOrders fetch failed for ${symbol}: ${msg}`);
    throw error;
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
  repairBlocked?: 'flat' | 'unknown';
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

  const unchanged = {binance_sl_order_id:slId,binance_tp_order_id:tpId,clearedSl:false,clearedTp:false};
  let openIds: Set<string>;
  try { openIds = await fetchOpenAlgoOrderIds(position.symbol); }
  catch { return {...unchanged,repairBlocked:'unknown'}; }
  if ((slId && !openIds.has(slId)) || (tpId && !openIds.has(tpId))) {
    // A triggered stop disappears from open orders before local close reconciliation.
    // Query authoritative positionRisk, without the demo user-trades fallback.
    try {
      const {getPositionRisk}=await import('./binance/account');
      const rows=await getPositionRisk(pairSymbol(position.symbol));
      if (!Array.isArray(rows)) return {...unchanged,repairBlocked:'unknown'};
      const matching=rows.filter(r=>r.symbol===pairSymbol(position.symbol));
      if (!matching.length || matching.some(r=>!Number.isFinite(r.positionAmt))) return {...unchanged,repairBlocked:'unknown'};
      if (matching.every(r=>Number(r.positionAmt)===0)) return {...unchanged,repairBlocked:'flat'};
    } catch { return {...unchanged,repairBlocked:'unknown'}; }
  }
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

/** Record local receipt of the exchange response without delaying protective placement. */
function recordProtectiveAcknowledgement(
  positionId: string, symbol: string, side: string, quantity: number,
  protectionType: 'stop_loss' | 'take_profit', triggerPrice: number,
  requestStartedAt: number, response: any
): void {
  const receivedAt = Date.now();
  const data = {
    acknowledgement_schema: 'client-receipt-v1',
    algo_contract_evidence: response.algo_contract_evidence ?? null,
    symbol, side, protection_type: protectionType,
    binance_order_id: response.orderId == null ? null : String(response.orderId),
    executed_qty: quantity, trigger_price: triggerPrice,
    request_started_at: new Date(requestStartedAt).toISOString(),
    acknowledgement_received_at: new Date(receivedAt).toISOString(),
    timestamp: new Date(receivedAt).toISOString(),
    exchange_status: response.status ?? null,
    working_type: response.workingType ?? null,
    acknowledgement_data_status: response.orderId == null ? 'missing_order_id' : 'observed',
  };
  void Promise.resolve().then(() => recordTestnetTradeEvent(positionId, 'protective_order_acknowledged', data))
    .catch(() => console.warn(`[ProtectiveOrder] Acknowledgement journal failed for ${positionId}`));
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
    const requestStartedAt = Date.now();
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
    recordProtectiveAcknowledgement(positionId, symbolUsdt, closeSide, executedQty,
      'stop_loss', levels.stop_loss, requestStartedAt, slOrder);
  } catch (error: unknown) {
    slError = error instanceof Error ? error.message : String(error);
  }
  }

  if (!opts?.skipTp) {
  try {
    const requestStartedAt = Date.now();
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
    recordProtectiveAcknowledgement(positionId, symbolUsdt, closeSide, executedQty,
      'take_profit', levels.take_profit, requestStartedAt, tpOrder);
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

async function marketCloseFromProtective(
  position: {
    position_id: string;
    account_id?: number;
    symbol: string;
    side: string;
    size_qty: number;
    entry_price: number;
    account?: { current_balance?: number };
  },
  mark: number,
  closeReason: 'protective_sl_breached_market' | 'protective_tp_reached_market' | 'protective_failed_market_close',
  eventReason: string
): Promise<boolean> {
  const label =
    closeReason === 'protective_sl_breached_market'
      ? 'SL breached — market close'
      : closeReason === 'protective_tp_reached_market'
        ? 'TP reached — market close'
        : 'Protective failed — market close';
  console.warn(
    `[ProtectiveOrder] ${position.position_id} ${label} mark=${mark} (${eventReason})`
  );
  notifyProtectiveAction(position, label, `mark=${mark} reason=${eventReason}`);
  return emergencyMarketCloseUnhedged(position, mark, eventReason, closeReason);
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
}): Promise<ProtectivePlacementOutcome> {
  const reconciled = await reconcileStaleProtectiveOrderIds(position);
  if (reconciled.repairBlocked) return reconciled.repairBlocked==='flat'?'skipped':'partial';
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
  let markStatus: 'observed' | 'missing' | 'failed' = 'missing';
  try {
    const { fetchBinanceNetPosition } = await import('./binance-exposure.service');
    const live = await fetchBinanceNetPosition(position.symbol);
    mark = live?.markPrice ?? 0;
    if (Number.isFinite(mark) && mark > 0) markStatus = 'observed';
  } catch {
    markStatus = 'failed';
    /* proceed */
  }

  if (mark > 0 && shouldSkipProtectiveRetry(position.position_id, mark)) {
    console.log(
      `[ProtectiveOrder] Skip retry for ${position.position_id} (cooldown, mark=${mark})`
    );
    return 'skipped';
  }

  // Capture by value before asynchronous persistence; telemetry must not block protection.
  const recordAction = (stage: 'planned' | 'recomputed', decision: string, levels?: SlTpLevels) => {
    const finite = (value: number) => Number.isFinite(value) ? value : null;
    const data = {
      schema: 'protective-action-v1', stage, mark_status: markStatus,
      observed_at: new Date().toISOString(),
      input: { side, stop_loss: finite(position.stop_loss), take_profit: finite(position.take_profit),
        mark: finite(mark), ...(levels ? { levels: { stop_loss: finite(levels.stop_loss), take_profit: finite(levels.take_profit) } } : {}) },
      decision,
    };
    void Promise.resolve().then(() => recordTestnetTradeEvent(position.position_id, 'protective_action_evaluated', data))
      .catch(() => console.warn('[ProtectiveOrder] Action journal persistence failed'));
  };

  const plannedAction = evaluateProtectiveAction({
    side,
    stop_loss: position.stop_loss,
    take_profit: position.take_profit,
    mark,
  });
  recordAction('planned', plannedAction);
  if (plannedAction === 'close_at_market_loss') {
    const closed = await marketCloseFromProtective(
      position,
      mark,
      'protective_sl_breached_market',
      'price_past_planned_sl'
    );
    return closed ? 'closed' : 'partial';
  }
  if (plannedAction === 'close_at_market_profit') {
    const closed = await marketCloseFromProtective(
      position,
      mark,
      'protective_tp_reached_market',
      'price_past_planned_tp'
    );
    return closed ? 'closed' : 'partial';
  }

  let fillRef = position.entry_price;
  if (
    mark > 0 &&
    (plannedAction === 'recompute_and_place' ||
      slTpInvalidForMark(side, position.stop_loss, mark) ||
      slTpInvalidForMark(
        side,
        recomputeSlTpFromFill({
          side,
          fillPrice: position.entry_price,
          plannedEntry: position.entry_price,
          plannedSl: position.stop_loss,
          plannedTp: position.take_profit,
        }).stop_loss,
        mark
      ))
  ) {
    fillRef =
      side === 'short'
        ? Math.max(position.entry_price, mark)
        : Math.min(position.entry_price, mark);
    console.warn(
      `[ProtectiveOrder] Recompute levels for ${position.position_id}: fillRef=${fillRef} mark=${mark}`
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

  const levelAction = evaluateProtectiveAction({
    side,
    stop_loss: position.stop_loss,
    take_profit: position.take_profit,
    mark,
    levels,
  });
  recordAction('recomputed', levelAction, levels);
  if (levelAction === 'close_at_market_loss') {
    const closed = await marketCloseFromProtective(
      position,
      mark,
      'protective_sl_breached_market',
      'recomputed_sl_breached'
    );
    return closed ? 'closed' : 'partial';
  }
  if (levelAction === 'close_at_market_profit') {
    const closed = await marketCloseFromProtective(
      position,
      mark,
      'protective_tp_reached_market',
      'recomputed_tp_reached'
    );
    return closed ? 'closed' : 'partial';
  }

  const hadSl = Boolean(position.binance_sl_order_id);
  const hadTp = Boolean(position.binance_tp_order_id);
  const skipTpInvalid = mark > 0 && tpInvalidForMark(side, levels.take_profit, mark);

  let result = await placeSlTpOnBinance(
    position.position_id,
    position.symbol,
    position.side,
    qty,
    levels,
    { skipSl: hadSl, skipTp: hadTp || skipTpInvalid }
  );
  let placedSlId = result.slId;
  let placedTpId = result.tpId;

  if (
    !result.slId &&
    !hadSl &&
    result.slError &&
    isOrderWouldTriggerImmediatelyError(result.slError) &&
    mark > 0
  ) {
    if (isPastStopLoss(side, levels.stop_loss, mark)) {
      const closed = await marketCloseFromProtective(
        position,
        mark,
        'protective_sl_breached_market',
        'sl_-2021_past_sl'
      );
      return closed ? 'closed' : 'partial';
    }

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
      {
        skipTp:
          hadTp ||
          Boolean(placedTpId) ||
          tpInvalidForMark(side, retryLevels.take_profit, mark),
      }
    );
    placedSlId = placedSlId ?? result.slId;
    placedTpId = placedTpId ?? result.tpId;
    Object.assign(levels, retryLevels);

    if (
      !result.slId &&
      result.slError &&
      isOrderWouldTriggerImmediatelyError(result.slError) &&
      isPastStopLoss(side, retryLevels.stop_loss, mark)
    ) {
      const closed = await marketCloseFromProtective(
        position,
        mark,
        'protective_sl_breached_market',
        'sl_-2021_retry_still_past_sl'
      );
      return closed ? 'closed' : 'partial';
    }
  }

  const slProtected = hadSl || Boolean(placedSlId);
  const tpProtected = hadTp || Boolean(placedTpId);

  if (slProtected) {
    clearProtectiveRetryState(position.position_id);
    if (!tpProtected) {
      if (
        !hadTp &&
        result.tpError &&
        isOrderWouldTriggerImmediatelyError(result.tpError) &&
        mark > 0
      ) {
        if (isPastTakeProfit(side, levels.take_profit, mark)) {
          const closed = await marketCloseFromProtective(
            position,
            mark,
            'protective_tp_reached_market',
            'tp_-2021_past_tp'
          );
          return closed ? 'closed' : 'partial';
        }
        console.warn(
          `[ProtectiveOrder] TP -2021 for ${position.position_id} — SL ok, skipping invalid TP (mark=${mark})`
        );
      } else {
        const reason = skipTpInvalid
          ? `tp_invalid_for_mark mark=${mark}`
          : result.tpError ?? 'tp_missing_after_placement';
        console.warn(
          `[ProtectiveOrder] TP missing for ${position.position_id} while SL is protected: ${reason}`
        );
      }
      notifyProtectiveAction(
        position,
        'Protective partial',
        `SL active but TP missing (${result.tpError ?? (skipTpInvalid ? 'tp_invalid_for_mark' : 'unknown')})`
      );
      return 'partial';
    }
    console.log(
      `[ProtectiveOrder] SL/TP protected for ${position.position_id}: ` +
        `sl=${levels.stop_loss} id=${placedSlId ?? position.binance_sl_order_id} ` +
        `tp=${levels.take_profit} id=${placedTpId ?? position.binance_tp_order_id}`
    );
    return 'ok';
  }

  recordProtectiveFailure(position.position_id, mark);
  console.error(
    `[ProtectiveOrder] SL failed for ${position.position_id}: ${result.slError ?? 'unknown'} — emergency market close`
  );

  const closed = await marketCloseFromProtective(
    position,
    mark,
    'protective_failed_market_close',
    result.slError ?? 'sl_placement_failed'
  );
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
  eventReason?: string,
  closeReason:
    | 'protective_sl_breached_market'
    | 'protective_tp_reached_market'
    | 'protective_failed_market_close' = 'protective_failed_market_close'
): Promise<boolean> {
  const mark = closePrice > 0 ? closePrice : position.entry_price;
  const bypassGuard =
    closeReason === 'protective_sl_breached_market' ||
    closeReason === 'protective_tp_reached_market';
  const guardSource =
    eventReason === 'monitor_unhedged_sl_progress'
      ? 'position_monitor_unhedged'
      : closeReason;

  const { prisma: db } = await import('../lib/prisma');
  const full = await db.testnetPosition.findUnique({
    where: { position_id: position.position_id },
    include: { account: true },
  });

  const closeResult = await closePositionOnBinanceMarket(
    {
      symbol: position.symbol,
      side: position.side,
      size_qty: position.size_qty,
    },
    undefined,
    {
      guardSource,
      bypassLifecycleGuard: bypassGuard,
      positionId: position.position_id,
      entryTime: full?.entry_time ?? null,
    }
  );

  if (!closeResult.ok) {
    const deferred = closeResult.reason?.includes('lifecycle_guard');
    if (deferred) {
      console.warn(
        `[ProtectiveOrder] Deferred emergency close for ${position.position_id}: ${closeResult.reason}`
      );
      return false;
    }
    console.error(
      `[ProtectiveOrder] Emergency close failed for ${position.position_id}: ${closeResult.reason}`
    );
    await recordTestnetTradeEvent(position.position_id, 'protective_failed', {
      reason: eventReason ?? 'sl_placement_failed',
      close_reason: closeReason,
      close_error: closeResult.reason,
      timestamp: new Date().toISOString(),
    });
    return false;
  }

  if (full?.status === 'open') {
    await closeLocalPosition(
      { ...full, account: full.account },
      mark,
      closeReason,
      { verified_binance_zero: true }
    );
  }

  await recordTestnetTradeEvent(position.position_id, 'protective_failed', {
    reason: eventReason ?? 'sl_placement_failed',
    close_reason: closeReason,
    action: 'market_close',
    close_price: mark,
    timestamp: new Date().toISOString(),
  });

  return true;
}

/** Planned SL/TP still valid relative to actual fill (long: SL < fill < TP; short: TP < fill < SL). */
export function arePlannedLevelsValidForFill(
  side: 'long' | 'short',
  fillPrice: number,
  plannedSl: number,
  plannedTp: number
): boolean {
  if (!Number.isFinite(fillPrice) || fillPrice <= 0) return false;
  if (!Number.isFinite(plannedSl) || !Number.isFinite(plannedTp)) return false;
  if (side === 'short') {
    return plannedTp < fillPrice && fillPrice < plannedSl;
  }
  return plannedSl < fillPrice && fillPrice < plannedTp;
}

/** Levels for a new fill before DB insert — preserve pending SL/TP when still valid for fill. */
export function resolveLevelsForFill(
  side: string,
  fillPrice: number,
  plannedEntry: number,
  plannedSl: number,
  plannedTp: number,
  markPrice?: number
): SlTpLevels {
  const s = side.toLowerCase() === 'short' ? 'short' : 'long';
  if (arePlannedLevelsValidForFill(s, fillPrice, plannedSl, plannedTp)) {
    return { stop_loss: plannedSl, take_profit: plannedTp };
  }
  return recomputeSlTpFromFill({
    side: s,
    fillPrice,
    plannedEntry,
    plannedSl: plannedSl,
    plannedTp: plannedTp,
    markPrice,
  });
}

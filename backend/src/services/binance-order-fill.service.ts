/**
 * Shared logic for Binance order fill price resolution and pending → position materialization.
 */

import {
  createTestnetPosition,
  executeTestnetPendingOrder,
  findTestnetPositionByBinanceOrderId,
  getTestnetPendingOrderByBinanceId,
  recordTestnetTradeEvent,
  updateTestnetPendingOrder,
} from '../repositories/testnet.repository';
import { placeStopLossOrder, placeTakeProfitOrder } from './binanceClient';

/** Binance ORDER_TRADE_UPDATE `o` payload (subset). */
export interface BinanceOrderTradeUpdate {
  z?: string;
  Z?: string;
  ap?: string;
  L?: string;
  p?: string;
}

export function resolveFillAvgPrice(
  order: BinanceOrderTradeUpdate,
  executedQty: number,
  fallbackEntryPrice?: number
): number {
  const ap = parseFloat(order.ap ?? '');
  if (Number.isFinite(ap) && ap > 0) return ap;

  const lastFilled = parseFloat(order.L ?? '');
  if (Number.isFinite(lastFilled) && lastFilled > 0) return lastFilled;

  const qty = executedQty > 0 ? executedQty : parseFloat(order.z ?? '0');
  const quote = parseFloat(order.Z ?? '0');
  if (qty > 0 && Number.isFinite(quote) && quote > 0) return quote / qty;

  const limitPrice = parseFloat(order.p ?? '');
  if (Number.isFinite(limitPrice) && limitPrice > 0) return limitPrice;

  if (fallbackEntryPrice && Number.isFinite(fallbackEntryPrice) && fallbackEntryPrice > 0) {
    return fallbackEntryPrice;
  }

  return 0;
}

export function resolveFillQty(order: BinanceOrderTradeUpdate, executedQty: number): number {
  if (executedQty > 0) return executedQty;
  const z = parseFloat(order.z ?? '0');
  return Number.isFinite(z) && z > 0 ? z : 0;
}

/**
 * Create open position from a filled pending order and place SL/TP on Binance.
 */
export async function materializePositionFromPendingFill(
  localOrder: {
    order_id: string;
    account_id: number;
    symbol: string;
    side: string;
    stop_loss: number;
    take_profit: number;
    risk_usd: number;
    risk_percent: number;
    expected_rr: number;
    linked_prediction_id?: number | null;
    binance_order_id?: string | null;
    entry_price?: number;
    status?: string;
  },
  executedQty: number,
  avgPrice: number,
  eventTime?: number
): Promise<string | null> {
  if (localOrder.binance_order_id) {
    const existing = await findTestnetPositionByBinanceOrderId(localOrder.binance_order_id);
    if (existing) {
      if (localOrder.status !== 'executed') {
        await executeTestnetPendingOrder(localOrder.order_id, existing.position_id);
      }
      const { prisma: db } = await import('../lib/prisma');
      const full = await db.testnetPosition.findUnique({
        where: { position_id: existing.position_id },
      });
      if (full) {
        await ensureProtectiveOrdersForPosition(full);
      }
      return existing.position_id;
    }
  }

  if (!Number.isFinite(avgPrice) || avgPrice <= 0) {
    console.error(
      `[BinanceOrderFill] Invalid avgPrice for order ${localOrder.order_id}: ${avgPrice}`
    );
    return null;
  }

  const qty = Math.abs(executedQty);
  if (!Number.isFinite(qty) || qty <= 0) {
    console.error(
      `[BinanceOrderFill] Invalid executedQty for order ${localOrder.order_id}: ${executedQty}`
    );
    return null;
  }

  const positionId = `pos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const sizeUsd = qty * avgPrice;

  await createTestnetPosition({
    positionId,
    accountId: localOrder.account_id,
    symbol: localOrder.symbol,
    side: localOrder.side,
    entryPrice: avgPrice,
    stopLoss: localOrder.stop_loss,
    takeProfit: localOrder.take_profit,
    sizeUsd,
    sizeQty: qty,
    riskUsd: localOrder.risk_usd,
    riskPercent: localOrder.risk_percent,
    expectedRr: localOrder.expected_rr,
    linkedPredictionId: localOrder.linked_prediction_id ?? undefined,
    binanceOrderId: localOrder.binance_order_id ?? undefined,
    binanceSlOrderId: undefined,
    binanceTpOrderId: undefined,
    tpLevels: undefined,
    tpHitCount: 0,
    partialClosed: 0,
    entryFee: 0,
  });

  await executeTestnetPendingOrder(localOrder.order_id, positionId);

  let linkedDecisionId: number | undefined;
  try {
    const { prisma: db } = await import('../lib/prisma');
    const { PIPELINE_EVENT_POSITION_ID } = await import('../repositories/testnet.repository');
    const linkEvents = await db.testnetTradeEvent.findMany({
      where: {
        position_id: PIPELINE_EVENT_POSITION_ID,
        event_type: 'pending_order_linked',
      },
      orderBy: { timestamp: 'desc' },
      take: 30,
    });
    for (const ev of linkEvents) {
      if (!ev.event_data) continue;
      const data = JSON.parse(ev.event_data) as {
        order_id?: string;
        decision_id?: number;
      };
      if (data.order_id === localOrder.order_id && typeof data.decision_id === 'number') {
        linkedDecisionId = data.decision_id;
        break;
      }
    }
  } catch {
    /* non-fatal */
  }

  const { resolveTestnetAccountBalances } = await import('./binance-balance-sync.service');
  const balances = await resolveTestnetAccountBalances(localOrder.account_id);

  await recordTestnetTradeEvent(positionId, 'entry_order_filled', {
    order_id: localOrder.order_id,
    binance_order_id: localOrder.binance_order_id,
    symbol: localOrder.symbol,
    side: localOrder.side,
    entry_price: avgPrice,
    stop_loss: localOrder.stop_loss,
    take_profit: localOrder.take_profit,
    executed_qty: qty,
    size_qty: qty,
    size_usd: sizeUsd,
    account_balance: balances.account_balance,
    account_equity: balances.account_equity,
    timestamp: new Date(eventTime ?? Date.now()).toISOString(),
    ...(linkedDecisionId != null ? { decision_id: linkedDecisionId } : {}),
  });

  await placeSlTpForPosition(positionId, localOrder.symbol, localOrder.side, qty, localOrder);

  console.log(
    `[BinanceOrderFill] Position ${positionId} from order ${localOrder.order_id} @ ${avgPrice}`
  );
  return positionId;
}

/**
 * Place SL/TP on Binance when missing (fill handler + reconciliation).
 */
export async function ensureProtectiveOrdersForPosition(position: {
  position_id: string;
  symbol: string;
  side: string;
  size_qty: number;
  stop_loss: number;
  take_profit: number;
  binance_sl_order_id?: string | null;
  binance_tp_order_id?: string | null;
}): Promise<void> {
  if (position.binance_sl_order_id && position.binance_tp_order_id) {
    return;
  }
  const qty = Math.abs(Number(position.size_qty));
  if (!Number.isFinite(qty) || qty <= 0) return;

  const side = String(position.side).toLowerCase();
  try {
    const { fetchBinanceNetPosition } = await import('./binance-exposure.service');
    const live = await fetchBinanceNetPosition(position.symbol);
    const mark = live?.markPrice ?? 0;
    if (mark > 0) {
      if (side === 'long' && position.stop_loss >= mark) {
        console.warn(
          `[BinanceOrderFill] Skip SL/TP for ${position.position_id}: long SL ${position.stop_loss} >= mark ${mark} (would trigger immediately)`
        );
        return;
      }
      if (side === 'short' && position.stop_loss <= mark) {
        console.warn(
          `[BinanceOrderFill] Skip SL/TP for ${position.position_id}: short SL ${position.stop_loss} <= mark ${mark} (would trigger immediately)`
        );
        return;
      }
    }
  } catch {
    /* proceed if mark lookup fails */
  }

  await placeSlTpForPosition(position.position_id, position.symbol, position.side, qty, {
    stop_loss: position.stop_loss,
    take_profit: position.take_profit,
  });
}

async function placeSlTpForPosition(
  positionId: string,
  symbol: string,
  positionSideLocal: string,
  executedQty: number,
  levels: { stop_loss: number; take_profit: number }
): Promise<void> {
  try {
    const { ensurePositionModeDetected, getPositionMode } = await import('./binance-hedge-mode');
    await ensurePositionModeDetected();

    const client = {};
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

    const { updateTestnetPosition } = await import('../repositories/testnet.repository');
    await updateTestnetPosition(positionId, {
      binance_sl_order_id: String(slOrder.orderId),
      binance_tp_order_id: String(tpOrder.orderId),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[BinanceOrderFill] SL/TP placement failed for ${positionId}:`, message);
  }
}

/**
 * Recover a single pending row using Binance order query (reconciliation / repair).
 */
export async function recoverPendingOrderFromBinance(
  localOrder: {
    order_id: string;
    account_id: number;
    symbol: string;
    side: string;
    entry_price: number;
    stop_loss: number;
    take_profit: number;
    risk_usd: number;
    risk_percent: number;
    expected_rr: number;
    linked_prediction_id?: number | null;
    binance_order_id?: string | null;
    status: string;
  }
): Promise<'filled' | 'cancelled' | 'unchanged' | 'failed'> {
  if (!localOrder.binance_order_id) {
    return 'failed';
  }

  const { getOrder } = await import('./binance/trading');
  const symbol = `${localOrder.symbol}USDT`;

  try {
    const remote = await getOrder(symbol, Number(localOrder.binance_order_id));

    if (remote.status === 'FILLED') {
      const qty = remote.executedQty > 0 ? remote.executedQty : 0;
      let avg =
        qty > 0 && remote.cummulativeQuoteQty > 0
          ? remote.cummulativeQuoteQty / qty
          : remote.price;
      if (!Number.isFinite(avg) || avg <= 0) {
        avg = localOrder.entry_price;
      }
      const positionId = await materializePositionFromPendingFill(localOrder, qty, avg);
      return positionId ? 'filled' : 'failed';
    }

    if (remote.status === 'CANCELED' || remote.status === 'EXPIRED' || remote.status === 'REJECTED') {
      await updateTestnetPendingOrder(localOrder.order_id, {
        status: remote.status.toLowerCase(),
      });
      return 'cancelled';
    }

    if (remote.status === 'NEW' || remote.status === 'PARTIALLY_FILLED') {
      await updateTestnetPendingOrder(localOrder.order_id, { status: 'pending' });
      return 'unchanged';
    }

    return 'unchanged';
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[BinanceOrderFill] recover ${localOrder.order_id} failed:`,
      message
    );
    return 'failed';
  }
}

export async function findLocalOrderForBinanceEvent(
  binanceOrderId: string,
  symbolUsdt: string
): Promise<Awaited<ReturnType<typeof getTestnetPendingOrderByBinanceId>>> {
  const symbol = symbolUsdt.replace('USDT', '');
  return getTestnetPendingOrderByBinanceId(binanceOrderId, symbol);
}

/**
 * Shared amend of exchange STOP + local stop_loss (profit-protect / invalidation).
 */

import { updateTestnetPosition, recordTestnetTradeEvent } from '../repositories/testnet.repository';
import { cancelAlgoOrder, placeStopLossOrder } from './binanceClient';
import { ensurePositionModeDetected, getPositionMode } from './binance-hedge-mode';

export interface AmendStopLossPosition {
  position_id: string;
  symbol: string;
  side: string;
  entry_price: number;
  stop_loss: number;
  size_qty: number;
  binance_sl_order_id?: string | null;
}

export async function amendProtectiveStopLoss(input: {
  position: AmendStopLossPosition;
  newSl: number;
  mark: number;
  eventType: string;
  action: string;
  reason: string;
  meta?: Record<string, unknown>;
}): Promise<{ ok: boolean; reason: string; newSlId?: string }> {
  const { position, newSl, mark, eventType, action, reason, meta } = input;

  if (process.env.BINANCE_ENABLED !== 'true') {
    return { ok: false, reason: 'binance disabled' };
  }

  const side = position.side.toLowerCase() === 'short' ? 'short' : 'long';
  const qty = Math.abs(Number(position.size_qty));
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, reason: 'invalid qty' };
  }
  if (!Number.isFinite(newSl) || newSl <= 0) {
    return { ok: false, reason: 'invalid newSl' };
  }
  if (side === 'long' && newSl >= mark) {
    return { ok: false, reason: `new SL ${newSl} >= mark ${mark}` };
  }
  if (side === 'short' && newSl <= mark) {
    return { ok: false, reason: `new SL ${newSl} <= mark ${mark}` };
  }

  await ensurePositionModeDetected();
  const symbolUsdt = `${position.symbol.toUpperCase().replace(/USDT$/i, '')}USDT`;
  const closeSide = side === 'long' ? 'SELL' : 'BUY';
  const mode = getPositionMode();
  const currentPosition = {
    positionAmt: side === 'long' ? qty : -qty,
    ...(mode === 'HEDGE' ? { positionSide: side === 'long' ? 'LONG' : 'SHORT' } : {}),
  };

  const oldSlId = position.binance_sl_order_id ? String(position.binance_sl_order_id) : null;

  // Place new first — avoid naked window. ponytail: cancel fail → two STOP algos briefly.
  let newSlId: string;
  try {
    const slOrder = await placeStopLossOrder(
      {},
      symbolUsdt,
      closeSide,
      qty,
      newSl,
      'CLOSE',
      currentPosition,
      null
    );
    newSlId = String(slOrder.orderId ?? slOrder.algoId);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `place SL failed: ${msg}` };
  }

  if (oldSlId && oldSlId !== newSlId) {
    try {
      await cancelAlgoOrder({}, symbolUsdt, oldSlId);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        `[AmendSL] New SL ${newSlId} placed but cancel old ${oldSlId} failed: ${msg}`
      );
    }
  }

  await updateTestnetPosition(position.position_id, {
    stop_loss: newSl,
    binance_sl_order_id: newSlId,
  });

  await recordTestnetTradeEvent(position.position_id, eventType, {
    action,
    reason,
    old_sl: position.stop_loss,
    new_sl: newSl,
    mark,
    old_sl_id: oldSlId,
    new_sl_id: newSlId,
    timestamp: new Date().toISOString(),
    ...meta,
  });

  return { ok: true, reason, newSlId };
}

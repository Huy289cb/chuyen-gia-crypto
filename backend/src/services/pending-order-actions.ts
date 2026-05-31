/**
 * Shared Binance + DB actions for pending limit orders.
 */

import { prisma } from '../lib/prisma';
import {
  cancelTestnetPendingOrder,
  PIPELINE_EVENT_POSITION_ID,
  recordPipelineEvent,
} from '../repositories/testnet.repository';
import { hookPendingCancelled } from './telegram/telegram-hooks';

export type PendingCancelReason =
  | 'ttl_expired'
  | 'price_drift'
  | 'manual'
  | 'ai_review';

export async function resolveTimeframeForPendingOrder(
  orderId: string
): Promise<string | null> {
  const events = await prisma.testnetTradeEvent.findMany({
    where: {
      position_id: PIPELINE_EVENT_POSITION_ID,
      event_type: 'pending_order_linked',
    },
    orderBy: { timestamp: 'desc' },
    take: 50,
  });

  for (const ev of events) {
    if (!ev.event_data) continue;
    try {
      const data = JSON.parse(ev.event_data) as { order_id?: string; timeframe?: string };
      if (data.order_id === orderId && typeof data.timeframe === 'string') {
        return data.timeframe;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function cancelPendingOnExchangeAndDb(
  order: { order_id: string; symbol: string; binance_order_id?: string | null },
  reason: PendingCancelReason
): Promise<void> {
  if (process.env.BINANCE_ENABLED === 'true' && order.binance_order_id) {
    try {
      const { initTestnetClient, cancelOrder } = await import('./binanceClient');
      const client = initTestnetClient();
      if (client) {
        await cancelOrder(client, `${order.symbol.toUpperCase()}USDT`, Number(order.binance_order_id));
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        `[PendingOrder] Binance cancel failed for ${order.order_id} (${order.binance_order_id}): ${msg}`
      );
    }
  }

  await cancelTestnetPendingOrder(order.order_id, reason);
  hookPendingCancelled(order.symbol, order.order_id, reason);

  await recordPipelineEvent('pending_order_cancelled', {
    order_id: order.order_id,
    reason,
    binance_order_id: order.binance_order_id ?? undefined,
  });
}

import { randomUUID } from 'node:crypto';
import { PENDING_ACTIVE_STATUSES, confirmsZeroFillCancellation } from '../utils/pending-cancel-transition';
export { isPendingOrderTerminal } from '../utils/pending-cancel-transition';
/**
 * Shared Binance + DB actions for pending limit orders.
 */

import { prisma } from '../lib/prisma';
import {
  PIPELINE_EVENT_POSITION_ID,
  recordPipelineEvent,
  recordSilentPipelineEvent,
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
  order: { order_id: string; symbol: string; binance_order_id?: string | null; status?: string },
  reason: PendingCancelReason
): Promise<void> {
  const current = await prisma.testnetPendingOrder.findUnique({
    where: { order_id: order.order_id }, select: { status: true },
  });
  if (!current || !PENDING_ACTIVE_STATUSES.has(current.status)) return;
  const cancelAttemptId = randomUUID();
  // Do not release local occupancy before the exchange confirms cancellation.
  // A failed/ambiguous cancel or partial fill must remain available to reconciliation.
  if (process.env.BINANCE_ENABLED === 'true') {
    if (!order.binance_order_id) throw new Error('pending_cancel_missing_exchange_identity');
    const exchangeId = Number(order.binance_order_id);
    if (!Number.isSafeInteger(exchangeId) || exchangeId <= 0) throw new Error('pending_cancel_invalid_exchange_identity');
    const { initTestnetClient, cancelOrder } = await import('./binanceClient');
    const client = initTestnetClient();
    if (!client) throw new Error('pending_cancel_client_unavailable');
    const ack = await cancelOrder(client, `${order.symbol.toUpperCase()}USDT`, exchangeId);
    const confirmed = confirmsZeroFillCancellation({symbol:order.symbol,exchangeOrderId:order.binance_order_id,ack});
    try {
      await recordSilentPipelineEvent('pending_cancel_ack', {
        schema:'pending-cancel-ack-v1',cancel_attempt_id:cancelAttemptId,order_id:order.order_id,symbol:order.symbol,
        exchange_order_id:order.binance_order_id,pending_status:current.status,reason,
        observed_at:new Date().toISOString(),
        ack:ack ? {orderId:ack.orderId ?? null,symbol:ack.symbol ?? null,
          status:ack.status ?? null,executedQty:ack.executedQty ?? null} : null,
        confirmed_zero_fill:confirmed,
      });
    } catch { console.warn('[PendingCancel] ACK journal persistence unavailable'); }
    if (!confirmed) {
      throw new Error('pending_cancel_requires_reconciliation');
    }
  }
  const claimed = await prisma.testnetPendingOrder.updateMany({
    where: {
      order_id: order.order_id,
      status: { in: [...PENDING_ACTIVE_STATUSES] },
    },
    data: { status: `cancelled_${reason}` },
  });
  try {
    await recordSilentPipelineEvent('pending_cancel_db_claim', {
      schema:'pending-cancel-claim-v1',cancel_attempt_id:cancelAttemptId,order_id:order.order_id,
      observed_at:new Date().toISOString(),claimed_count:claimed.count,target_status:`cancelled_${reason}`,
    });
  } catch { console.warn('[PendingCancel] Claim journal persistence unavailable'); }
  if (claimed.count === 0) {
    return;
  }

  hookPendingCancelled(order.symbol, order.order_id, reason);

  await recordPipelineEvent('pending_order_cancelled', {
    order_id: order.order_id,
    reason,
    symbol: order.symbol,
    binance_order_id: order.binance_order_id ?? undefined,
  });
}

/**
 * Expire stale limit pending orders (TTL + price drift) and free pipeline capacity.
 */

import { prisma } from '../lib/prisma';
import { getLatestPrice } from '../repositories/market.repository';
import {
  getPendingOrderMaxDriftPct,
  getPendingOrderTtlHours,
  isPendingOrderLifecycleEnabled,
} from '../config/pending-order-policy';
import {
  cancelPendingOnExchangeAndDb,
  resolveTimeframeForPendingOrder,
  type PendingCancelReason,
} from './pending-order-actions';

export type { PendingCancelReason };

export interface PendingLifecycleResult {
  reviewed: number;
  cancelled: number;
  reasons: Array<{ order_id: string; reason: PendingCancelReason }>;
}

function entryDriftExceeded(entryPrice: number, markPrice: number, maxDriftPct: number): boolean {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(markPrice) || markPrice <= 0) {
    return false;
  }
  return Math.abs(markPrice - entryPrice) / entryPrice >= maxDriftPct;
}

/**
 * Review all pending limit orders: cancel on TTL or adverse price drift.
 */
export async function runPendingOrderLifecycle(
  symbol = 'BTC'
): Promise<PendingLifecycleResult> {
  const result: PendingLifecycleResult = { reviewed: 0, cancelled: 0, reasons: [] };

  if (!isPendingOrderLifecycleEnabled()) {
    return result;
  }

  const pending = await prisma.testnetPendingOrder.findMany({
    where: { symbol: symbol.toUpperCase(), status: 'pending' },
    orderBy: { created_at: 'asc' },
  });

  if (pending.length === 0) return result;

  const latest = await getLatestPrice(symbol);
  const markPrice = latest?.price ?? 0;
  const maxDriftPct = getPendingOrderMaxDriftPct();
  const now = Date.now();

  for (const order of pending) {
    result.reviewed += 1;
    const ageHours = (now - new Date(order.created_at).getTime()) / (3600 * 1000);
    const timeframe = await resolveTimeframeForPendingOrder(order.order_id);
    const ttlHours = getPendingOrderTtlHours(timeframe);

    if (ageHours >= ttlHours) {
      await cancelPendingOnExchangeAndDb(order, 'ttl_expired');
      result.cancelled += 1;
      result.reasons.push({ order_id: order.order_id, reason: 'ttl_expired' });
      console.log(
        `[PendingLifecycle] TTL cancel ${order.order_id} age=${ageHours.toFixed(1)}h ttl=${ttlHours}h tf=${timeframe ?? 'default'}`
      );
      continue;
    }

    if (markPrice > 0 && entryDriftExceeded(order.entry_price, markPrice, maxDriftPct)) {
      await cancelPendingOnExchangeAndDb(order, 'price_drift');
      result.cancelled += 1;
      result.reasons.push({ order_id: order.order_id, reason: 'price_drift' });
      console.log(
        `[PendingLifecycle] Drift cancel ${order.order_id} entry=${order.entry_price} mark=${markPrice} maxDrift=${(maxDriftPct * 100).toFixed(2)}%`
      );
    }
  }

  return result;
}

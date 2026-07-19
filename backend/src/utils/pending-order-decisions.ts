/**
 * Validate and apply LLM pending_order_decisions (hold / cancel / modify).
 */

import { getPendingOrderReviewMinAgeMinutes } from '../config/pending-order-policy';
import {
  getTestnetPendingOrders,
  updateTestnetPendingOrder,
} from '../repositories/testnet.repository';
import { cancelPendingOnExchangeAndDb } from '../services/pending-order-actions';

/** Pure age gate for AI cancel (minutes). */
export function isPendingTooYoungForAiCancel(
  createdAt: Date | string,
  nowMs: number,
  minAgeMinutes: number
): boolean {
  if (!(minAgeMinutes > 0)) return false;
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) return false;
  return (nowMs - createdMs) / 60_000 < minAgeMinutes;
}

export interface PendingOrderDecision {
  order_id: string;
  action: 'hold' | 'cancel' | 'modify';
  confidence: number;
  reason: string;
  new_entry?: number | null;
  new_sl?: number | null;
  new_tp?: number | null;
}

export function parsePendingOrderDecisions(raw: unknown): PendingOrderDecision[] {
  if (!raw || !Array.isArray(raw)) return [];

  const validActions = ['hold', 'cancel', 'modify'] as const;

  return raw
    .filter((dec): dec is Record<string, unknown> => dec != null && typeof dec === 'object')
    .filter((dec) => {
      if (typeof dec.order_id !== 'string' || typeof dec.action !== 'string' || !dec.reason) {
        return false;
      }
      if (!validActions.includes(dec.action as (typeof validActions)[number])) {
        return false;
      }
      const confidence = Number(dec.confidence);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        return false;
      }
      if (dec.action === 'modify' && !dec.new_entry && !dec.new_sl && !dec.new_tp) {
        return false;
      }
      return true;
    })
    .map((dec) => ({
      order_id: String(dec.order_id),
      action: dec.action as PendingOrderDecision['action'],
      confidence: Number(dec.confidence),
      reason: String(dec.reason),
      new_entry: dec.new_entry != null ? Number(dec.new_entry) : null,
      new_sl: dec.new_sl != null ? Number(dec.new_sl) : null,
      new_tp: dec.new_tp != null ? Number(dec.new_tp) : null,
    }));
}

function validateModifyLevels(
  order: { side: string; entry_price: number },
  updates: { entry_price?: number; stop_loss?: number; take_profit?: number }
): boolean {
  const entry = updates.entry_price ?? order.entry_price;
  const side = order.side.toLowerCase();

  if (updates.stop_loss != null) {
    const sl = updates.stop_loss;
    const minDist = entry * 0.005;
    if (Math.abs(sl - entry) < minDist) return false;
    if ((side === 'long' || side === 'buy') && sl >= entry) return false;
    if ((side === 'short' || side === 'sell') && sl <= entry) return false;
  }

  if (updates.take_profit != null) {
    const tp = updates.take_profit;
    if ((side === 'long' || side === 'buy') && tp <= entry) return false;
    if ((side === 'short' || side === 'sell') && tp >= entry) return false;
  }

  return true;
}

export interface ApplyPendingDecisionsResult {
  processed: number;
  cancelled: number;
  modified: number;
  held: number;
  skipped: number;
}

export async function applyPendingOrderDecisions(
  decisions: PendingOrderDecision[],
  minConfidence: number
): Promise<ApplyPendingDecisionsResult> {
  const result: ApplyPendingDecisionsResult = {
    processed: 0,
    cancelled: 0,
    modified: 0,
    held: 0,
    skipped: 0,
  };

  for (const dec of decisions) {
    result.processed += 1;

    if (dec.action === 'hold') {
      result.held += 1;
      continue;
    }

    if (dec.confidence < minConfidence) {
      result.skipped += 1;
      console.log(
        `[PendingReview] Skip ${dec.action} ${dec.order_id} — confidence ${(dec.confidence * 100).toFixed(0)}% < ${(minConfidence * 100).toFixed(0)}%`
      );
      continue;
    }

    const rows = await getTestnetPendingOrders({ orderId: dec.order_id, status: 'pending' });
    if (!rows.length) {
      result.skipped += 1;
      continue;
    }
    const order = rows[0];

    if (dec.action === 'cancel') {
      const minAge = getPendingOrderReviewMinAgeMinutes();
      if (isPendingTooYoungForAiCancel(order.created_at, Date.now(), minAge)) {
        result.skipped += 1;
        console.log(
          `[PendingReview] Skip AI cancel ${dec.order_id} — age < ${minAge}m (hold for fill/TTL/drift)`
        );
        continue;
      }
      await cancelPendingOnExchangeAndDb(order, 'ai_review');
      result.cancelled += 1;
      console.log(`[PendingReview] AI cancel ${dec.order_id}: ${dec.reason}`);
      continue;
    }

    if (dec.action === 'modify') {
      const updates: {
        entry_price?: number;
        stop_loss?: number;
        take_profit?: number;
      } = {};
      if (dec.new_entry != null && Number.isFinite(dec.new_entry)) {
        updates.entry_price = dec.new_entry;
      }
      if (dec.new_sl != null && Number.isFinite(dec.new_sl)) {
        updates.stop_loss = dec.new_sl;
      }
      if (dec.new_tp != null && Number.isFinite(dec.new_tp)) {
        updates.take_profit = dec.new_tp;
      }

      if (Object.keys(updates).length === 0 || !validateModifyLevels(order, updates)) {
        result.skipped += 1;
        console.warn(`[PendingReview] Invalid modify for ${dec.order_id} — skipped`);
        continue;
      }

      await updateTestnetPendingOrder(dec.order_id, updates);
      result.modified += 1;
      console.log(
        `[PendingReview] DB modify ${dec.order_id} (Binance limit unchanged): ${dec.reason}`,
        updates
      );
    }
  }

  return result;
}

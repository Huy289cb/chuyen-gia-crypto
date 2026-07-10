/**
 * LLM review of unfilled limit pending orders (hold / cancel / modify).
 * Runs when pending exists — does not block new-trade dispatch path.
 */

import { prisma } from '../lib/prisma';
import { getLatestPrice } from '../repositories/market.repository';
import { createGroqClient } from './groq-client';
import { memoryService } from './memory.service';
import {
  getPendingOrderReviewMinConfidence,
  getPendingOrderTtlHours,
  isPendingOrderReviewEnabled,
} from '../config/pending-order-policy';
import { resolveTimeframeForPendingOrder } from './pending-order-actions';
import {
  applyPendingOrderDecisions,
  parsePendingOrderDecisions,
} from '../utils/pending-order-decisions';
import { getScanResult } from '../schedulers/market-scan.scheduler';

const REVIEW_SYSTEM_PROMPT = `You are a crypto futures risk reviewer for UNFILLED LIMIT orders only.
Return valid JSON only (no markdown):
{
  "pending_order_decisions": [
    {
      "order_id": "string (exact from context)",
      "action": "hold|cancel|modify",
      "confidence": 0.0-1.0,
      "reason": "short explanation",
      "new_entry": number|null,
      "new_sl": number|null,
      "new_tp": number|null
    }
  ]
}
Rules:
- cancel: setup invalid, price moved away, order too old, or HTF/regime no longer supports the trade
- hold: limit entry still valid and worth waiting
- modify: only minor SL/TP tweaks in DB (exchange order price unchanged)
- Use confidence >= 0.85 only when very sure about cancel
- One decision per order_id in context`;

export interface PendingReviewResult {
  reviewed: number;
  llmCalled: boolean;
  cancelled: number;
  modified: number;
  held: number;
  skipped: number;
}

async function buildPendingReviewUserPrompt(
  symbol: string,
  orders: Array<{
    order_id: string;
    side: string;
    entry_price: number;
    stop_loss: number;
    take_profit: number;
    size_usd: number;
    created_at: Date;
  }>,
  markPrice: number
): Promise<string> {
  const now = Date.now();
  const lines: string[] = [
    `Symbol: ${symbol}`,
    `Mark price: ${markPrice}`,
    '',
    'PENDING LIMIT ORDERS:',
  ];

  for (const o of orders) {
    const ageHours = (now - new Date(o.created_at).getTime()) / (3600 * 1000);
    const tf = await resolveTimeframeForPendingOrder(o.order_id);
    const ttl = getPendingOrderTtlHours(tf);
    lines.push(
      `- order_id=${o.order_id} side=${o.side} entry=${o.entry_price} sl=${o.stop_loss} tp=${o.take_profit} size_usd=${o.size_usd.toFixed(0)} age_hours=${ageHours.toFixed(2)} ttl_hours=${ttl} tf=${tf ?? 'unknown'}`
    );
  }

  const scan15 = getScanResult(symbol, '15m');
  if (scan15?.signalResult) {
    lines.push('');
    lines.push(
      `Market (15m): regime=${scan15.signalResult.setupResult?.regime ?? 'unknown'} grade=${scan15.signalResult.setupResult?.grade ?? '?'} gate_pass=${scan15.signalResult.pass}`
    );
  }

  const reflection = await memoryService.formatRecentReflectionsForPrompt(symbol);
  if (reflection) {
    lines.push('');
    lines.push(reflection);
  }

  lines.push('');
  lines.push('Respond with pending_order_decisions for every order above.');

  return lines.join('\n');
}

/**
 * Ask LLM to review pending limits; apply cancel/modify when confidence passes threshold.
 */
export async function runPendingOrderReview(symbol = 'BTC'): Promise<PendingReviewResult> {
  const empty: PendingReviewResult = {
    reviewed: 0,
    llmCalled: false,
    cancelled: 0,
    modified: 0,
    held: 0,
    skipped: 0,
  };

  if (!isPendingOrderReviewEnabled()) {
    return empty;
  }

  const pending = await prisma.testnetPendingOrder.findMany({
    where: { symbol: symbol.toUpperCase(), status: 'pending' },
    orderBy: { created_at: 'asc' },
  });

  if (pending.length === 0) {
    return empty;
  }

  const latest = await getLatestPrice(symbol);
  const markPrice = latest?.price ?? 0;
  if (markPrice <= 0) {
    console.warn('[PendingReview] No mark price — skip LLM review');
    return { ...empty, reviewed: pending.length };
  }

  const client = createGroqClient();
  if (!client) {
    console.warn('[PendingReview] Groq unavailable — skip');
    return { ...empty, reviewed: pending.length };
  }

  const userPrompt = await buildPendingReviewUserPrompt(symbol, pending, markPrice);

  try {
    const analysis = await client.analyze({
      systemPrompt: REVIEW_SYSTEM_PROMPT,
      userPrompt,
      temperature: 0.2,
      maxRetries: 1,
      preferredModels: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
    });

    const decisions = parsePendingOrderDecisions(analysis.pending_order_decisions);
    if (decisions.length === 0) {
      console.log('[PendingReview] No valid pending_order_decisions in LLM response');
      return { ...empty, reviewed: pending.length, llmCalled: true };
    }

    const applied = await applyPendingOrderDecisions(
      decisions,
      getPendingOrderReviewMinConfidence()
    );

    console.log(
      `[PendingReview] Applied: cancelled=${applied.cancelled} modified=${applied.modified} held=${applied.held} skipped=${applied.skipped}`
    );

    return {
      reviewed: pending.length,
      llmCalled: true,
      cancelled: applied.cancelled,
      modified: applied.modified,
      held: applied.held,
      skipped: applied.skipped,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[PendingReview] LLM review failed: ${msg}`);
    return { ...empty, reviewed: pending.length, llmCalled: true };
  }
}

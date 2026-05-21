/**
 * Persist trade_outcomes on every confirmed close for edge measurement.
 */

import { prisma } from '../lib/prisma';
import { memoryService } from './memory.service';

export interface CloseOutcomeContext {
  position_id: string;
  symbol: string;
  side: string;
  entry_price: number;
  entry_time: Date;
  stop_loss: number;
  take_profit: number;
  expected_rr: number;
  risk_usd: number;
  entry_fee?: number;
  exit_fee?: number;
  funding_fee?: number;
  close_reason: string;
  decision_id?: number;
}

function outcomeLabel(pnl: number): 'win' | 'loss' | 'breakeven' {
  if (pnl > 0.01) return 'win';
  if (pnl < -0.01) return 'loss';
  return 'breakeven';
}

/**
 * Resolve trade_decision id for a closed position (no schema migration required).
 */
export async function resolveDecisionIdForPosition(ctx: CloseOutcomeContext): Promise<number | null> {
  if (ctx.decision_id != null && ctx.decision_id > 0) {
    return ctx.decision_id;
  }

  const events = await prisma.testnetTradeEvent.findMany({
    where: { position_id: ctx.position_id },
    orderBy: { timestamp: 'asc' },
    take: 20,
  });

  for (const ev of events) {
    if (!ev.event_data) continue;
    try {
      const data = JSON.parse(ev.event_data) as { decision_id?: number };
      if (typeof data.decision_id === 'number' && data.decision_id > 0) {
        return data.decision_id;
      }
    } catch {
      /* ignore */
    }
  }

  const windowStart = new Date(ctx.entry_time.getTime() - 6 * 60 * 60 * 1000);
  const candidates = await prisma.tradeDecision.findMany({
    where: {
      symbol: ctx.symbol,
      decision: 'trade',
      method_id: 'kim_nghia',
      timestamp: { gte: windowStart, lte: ctx.entry_time },
      trade_outcome: null,
    },
    orderBy: { timestamp: 'desc' },
    take: 10,
  });

  for (const d of candidates) {
    if (d.entry_price == null) continue;
    const diff = Math.abs(d.entry_price - ctx.entry_price) / ctx.entry_price;
    if (diff <= 0.02) return d.id;
  }

  if (candidates.length > 0) return candidates[0].id;
  return null;
}

/**
 * Record trade_outcome + playbook stats after a confirmed close.
 */
export async function recordTradeOutcomeOnClose(
  ctx: CloseOutcomeContext,
  closePrice: number,
  realizedPnl: number
): Promise<void> {
  const decisionId = await resolveDecisionIdForPosition(ctx);
  if (decisionId == null) {
    console.warn(
      `[TradeOutcome] No trade_decision linked for ${ctx.position_id} — outcome not stored`
    );
    return;
  }

  const existing = await prisma.tradeOutcome.findUnique({
    where: { decision_id: decisionId },
  });
  if (existing) {
    console.log(`[TradeOutcome] Outcome already exists for decision ${decisionId}`);
    return;
  }

  const riskUsd = ctx.risk_usd > 0 ? ctx.risk_usd : 1;
  const realizedRr = realizedPnl / riskUsd;
  const fees =
    (ctx.entry_fee ?? 0) + (ctx.exit_fee ?? 0) + (ctx.funding_fee ?? 0);
  const durationMinutes = Math.max(
    0,
    Math.round((Date.now() - ctx.entry_time.getTime()) / 60000)
  );
  const label = outcomeLabel(realizedPnl);

  try {
    const outcome = await memoryService.storeOutcome({
      decision_id: decisionId,
      symbol: ctx.symbol,
      outcome: label,
      entry_price: ctx.entry_price,
      exit_price: closePrice,
      realized_pnl: realizedPnl,
      realized_rr: realizedRr,
      execution_cost: fees,
      duration_minutes: durationMinutes,
      close_reason: ctx.close_reason,
    });

    await memoryService.generateReflection(outcome.id, label, realizedPnl);
    console.log(
      `[TradeOutcome] Stored ${label} for ${ctx.symbol} decision=${decisionId} pnl=${realizedPnl.toFixed(2)} rr=${realizedRr.toFixed(2)}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[TradeOutcome] Failed to store outcome for ${ctx.position_id}: ${msg}`);
  }
}

import { evaluatePendingCancelCooldown, evaluatePostCloseCooldown, snapshotPendingCancelInputs } from '../utils/entry-history-cooldown-evaluation';
import { randomUUID } from 'node:crypto';
import { recordEntryStage } from '../utils/entry-trace';
import { publishExposureObservation } from '../utils/exposure-observation-publish';
import { evaluateSymbolExposure } from '../utils/symbol-exposure-evaluation';
/**
 * Shared entry eligibility for LLM dispatch and V3 execution (scale-in within exposure cap).
 */

import { getRiskPolicy } from '../config/risk-policy';
import {
  getPendingOrderReentryCooldownMinutes,
  getPostCloseSameSideCooldownMinutes,
} from '../config/pending-order-policy';
import { isV3ScaleInEnabled, resolveMaxTotalExposureUsd, getBinanceMinOrderNotionalUsd, minNotionalWithTolerance, getNotionalTolerancePercent } from '../config/v3-entry-policy';
import { prisma } from '../lib/prisma';
import { hasBinanceExposureForSide } from './binance-exposure.service';
import { assertTestnetAccountCanOpenTrade } from './account-risk-guard.service';
import {
  getActiveTestnetPositions,
  getBlockingTestnetPendingOrders,
  getOrCreateTestnetAccount,
  PIPELINE_EVENT_POSITION_ID,
} from '../repositories/testnet.repository';

export type LocalSide = 'long' | 'short';

export interface SymbolExposureSnapshot {
  openUsd: number;
  pendingUsd: number;
  totalUsd: number;
  maxExposureUsd: number;
  remainingUsd: number;
  openSides: LocalSide[];
  pendingSides: LocalSide[];
}

export function oppositeLocalSide(side: LocalSide): LocalSide {
  return side === 'long' ? 'short' : 'long';
}

export async function getSymbolExposureSnapshot(
  symbol: string,
  methodId = 'kim_nghia'
): Promise<SymbolExposureSnapshot> {
  const read_started_at = new Date().toISOString();
  const [openPositions, pendingOrders, account] = await Promise.all([
    getActiveTestnetPositions({ symbol, methodId }),
    getBlockingTestnetPendingOrders({ symbol, methodId }),
    getOrCreateTestnetAccount(symbol, methodId, 10000),
  ]);

  const read_returned_at = new Date().toISOString();
  const balance = Number(account.current_balance ?? account.equity ?? 10000);
  const riskPolicy = getRiskPolicy();
  const maxExposureUsd = resolveMaxTotalExposureUsd(balance, riskPolicy.maxTotalExposureUsd);

  const exposure = evaluateSymbolExposure(openPositions, pendingOrders, maxExposureUsd);
  publishExposureObservation({
    input: { schema: 'symbol-exposure-read-v1', read_id: randomUUID(), symbol, method_id: methodId,
      read_started_at, read_returned_at, observed_at: new Date().toISOString(),
      account_id: account.id, balance_input: account.current_balance ?? account.equity ?? null,
      max_exposure_usd: maxExposureUsd,
      open_positions: openPositions.map(p => ({ position_id: p.position_id, side: p.side, status: p.status, size_usd: p.size_usd })),
      pending_orders: pendingOrders.map(o => ({ order_id: o.order_id, side: o.side, status: o.status, size_usd: o.size_usd })),
      read_atomicity: 'parallel_repository_reads_not_joint_snapshot' },
    decision: exposure,
  }, data => recordEntryStage('symbol_exposure_evaluated', data));
  return exposure;
}

async function hasRecentPendingCancelCooldown(symbol: string): Promise<string | null> {
  const cooldownMin = getPendingOrderReentryCooldownMinutes();
  if (!(cooldownMin > 0)) return null;
  const since = new Date(Date.now() - cooldownMin * 60_000);
  const read_started_at = new Date().toISOString();
  const events = await prisma.testnetTradeEvent.findMany({
    where: {
      position_id: PIPELINE_EVENT_POSITION_ID,
      event_type: 'pending_order_cancelled',
      timestamp: { gte: since },
    },
    orderBy: { timestamp: 'desc' },
    take: 20,
    select: { event_data: true, timestamp: true },
  });
  const read_returned_at = new Date().toISOString();
  const decision_at = Date.now();
  const decision = evaluatePendingCancelCooldown(symbol, cooldownMin, events, () => decision_at);
  publishExposureObservation({input:{schema:'entry-history-cooldown-read-v1',kind:'pending_cancel',read_id:randomUUID(),symbol,
    cooldown_min:cooldownMin,query_since:since.toISOString(),query_limit:20,read_started_at,read_returned_at,decision_at,
    events:snapshotPendingCancelInputs(events)},decision}, data=>recordEntryStage('entry_history_cooldown_evaluated',data));
  return decision;
}

/**
 * Anti-chase: block either-side entry soon after a close (longer after a loss).
 */
export async function assertSameSidePostCloseCooldown(
  symbol: string,
  _side: LocalSide,
  methodId = 'kim_nghia'
): Promise<string | null> {
  const winCd = getPostCloseSameSideCooldownMinutes(false);
  const lossCd = getPostCloseSameSideCooldownMinutes(true);
  const lookbackMin = Math.max(winCd, lossCd);
  if (!(lookbackMin > 0)) return null;

  const since = new Date(Date.now() - lookbackMin * 60_000);
  const sym = symbol.toUpperCase().replace(/USDT$/i, '');
  const read_started_at = new Date().toISOString();
  const recent = await prisma.testnetPosition.findFirst({
    where: {
      symbol: sym,
      status: 'closed',
      close_time: { gte: since },
      account: { method_id: methodId },
    },
    orderBy: { close_time: 'desc' },
    select: { close_time: true, realized_pnl: true, position_id: true, side: true },
  });
  const read_returned_at = new Date().toISOString();
  if (!recent?.close_time) {
    publishExposureObservation({input:{schema:'entry-history-cooldown-read-v1',kind:'post_close',read_id:randomUUID(),symbol:sym,method_id:methodId,
      cooldown_min:lookbackMin,query_since:since.toISOString(),read_started_at,read_returned_at,decision_at:Date.now(),recent:null},decision:null},
      data=>recordEntryStage('entry_history_cooldown_evaluated',data));
    return null;
  }

  const wasLoss = (recent.realized_pnl ?? 0) < -0.01;
  const cooldownMin = getPostCloseSameSideCooldownMinutes(wasLoss);
  if (!(cooldownMin > 0)) return null;

  const decision_at = Date.now();
  const decision = evaluatePostCloseCooldown({ close_time: recent.close_time, side: recent.side }, wasLoss, cooldownMin, () => decision_at);
  publishExposureObservation({input:{schema:'entry-history-cooldown-read-v1',kind:'post_close',read_id:randomUUID(),symbol:sym,method_id:methodId,
    cooldown_min:cooldownMin,query_since:since.toISOString(),read_started_at,read_returned_at,decision_at,
    recent:{position_id:recent.position_id,side:recent.side,close_time:recent.close_time.toISOString(),realized_pnl:recent.realized_pnl}},decision},
    data=>recordEntryStage('entry_history_cooldown_evaluated',data));
  return decision;
}

export async function canRunLlmDispatchForSymbol(
  symbol: string,
  methodId = 'kim_nghia'
): Promise<{ allowed: boolean; reason: string }> {
  const account = await prisma.testnetAccount.findUnique({
    where: { symbol_method_id: { symbol: symbol.toUpperCase(), method_id: methodId } },
  });
  if (account) {
    const guard = await assertTestnetAccountCanOpenTrade(account.id, symbol);
    if (!guard.allowed) {
      return { allowed: false, reason: guard.reason };
    }
  }

  // This legacy-named guard blocks either side. Check before the scheduler
  // consumes a durable retest claim or pays for an LLM review; execution still
  // rechecks it to cover a position closing between admission and submission.
  const postCloseCooldown = await assertSameSidePostCloseCooldown(symbol, 'long', methodId);
  if (postCloseCooldown) {
    return { allowed: false, reason: postCloseCooldown };
  }

  const blockingPending = await getBlockingTestnetPendingOrders({ symbol, methodId });
  const unresolved = blockingPending.filter(
    (o) => o.status === 'reconciliation_failed_not_on_binance'
  );
  if (unresolved.length > 0) {
    return {
      allowed: false,
      reason: `blocking pending=${blockingPending.length} (${unresolved.length} unresolved reconcile)`,
    };
  }

  if (blockingPending.length > 0 && !isV3ScaleInEnabled()) {
    return {
      allowed: false,
      reason: `blocking pending=${blockingPending.length}`,
    };
  }

  const cancelCooldown = await hasRecentPendingCancelCooldown(symbol);
  if (cancelCooldown) {
    return { allowed: false, reason: cancelCooldown };
  }

  const exposure = await getSymbolExposureSnapshot(symbol, methodId);

  if (exposure.totalUsd >= exposure.maxExposureUsd) {
    return {
      allowed: false,
      reason: `max exposure reached (${exposure.totalUsd.toFixed(0)}/${exposure.maxExposureUsd.toFixed(0)} USD)`,
    };
  }

  if (!isV3ScaleInEnabled()) {
    const openCount = exposure.openSides.length > 0 ? 1 : 0;
    if (openCount > 0) {
      return { allowed: false, reason: `open=${openCount} (scale-in disabled)` };
    }
    if (blockingPending.length > 0) {
      return { allowed: false, reason: `blocking pending=${blockingPending.length}` };
    }
    return { allowed: true, reason: 'ok' };
  }

  const sides = new Set([...exposure.openSides, ...exposure.pendingSides]);
  if (sides.has('long') && sides.has('short')) {
    return { allowed: false, reason: 'mixed long+short exposure (scale-in blocked)' };
  }

  if (exposure.remainingUsd <= 0) {
    return {
      allowed: false,
      reason: `no remaining exposure room (${exposure.totalUsd.toFixed(0)}/${exposure.maxExposureUsd.toFixed(0)} USD)`,
    };
  }

  const minNotional = getBinanceMinOrderNotionalUsd();
  const minFloor = minNotionalWithTolerance(minNotional, getNotionalTolerancePercent());
  if (exposure.openUsd > 0 && exposure.remainingUsd < minFloor) {
    return {
      allowed: false,
      reason: `scale-in headroom $${exposure.remainingUsd.toFixed(0)} below Binance min order $${minNotional}`,
    };
  }

  return {
    allowed: true,
    reason: `scale-in ok (${exposure.totalUsd.toFixed(0)}/${exposure.maxExposureUsd.toFixed(0)} USD, room ~${exposure.remainingUsd.toFixed(0)})`,
  };
}

export async function assertScaleInSideAllowed(
  symbol: string,
  side: LocalSide
): Promise<string | null> {
  if (!isV3ScaleInEnabled()) {
    try {
      const onExchange = await hasBinanceExposureForSide(symbol, side);
      if (onExchange) {
        return `Binance already has ${side} exposure for ${symbol} (scaling-in disabled)`;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[V3Entry] Binance exposure check failed: ${message}`);
    }
    return null;
  }

  const opposite = oppositeLocalSide(side);
  try {
    const oppositeOnExchange = await hasBinanceExposureForSide(symbol, opposite);
    if (oppositeOnExchange) {
      return `Cannot open ${side}: Binance already has opposite ${opposite} exposure`;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[V3Entry] Binance opposite-side check failed: ${message}`);
  }

  return null;
}

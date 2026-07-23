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
  const [openPositions, pendingOrders, account] = await Promise.all([
    getActiveTestnetPositions({ symbol, methodId }),
    getBlockingTestnetPendingOrders({ symbol, methodId }),
    getOrCreateTestnetAccount(symbol, methodId, 10000),
  ]);

  const balance = Number(account.current_balance ?? account.equity ?? 10000);
  const riskPolicy = getRiskPolicy();
  const maxExposureUsd = resolveMaxTotalExposureUsd(balance, riskPolicy.maxTotalExposureUsd);

  const openUsd = openPositions.reduce(
    (sum, p) => sum + Math.abs(Number(p.size_usd) || 0),
    0
  );
  const pendingUsd = pendingOrders.reduce(
    (sum, o) => sum + Math.abs(Number(o.size_usd) || 0),
    0
  );
  const totalUsd = openUsd + pendingUsd;

  const openSides = [
    ...new Set(
      openPositions
        .map((p) => String(p.side).toLowerCase())
        .filter((s): s is LocalSide => s === 'long' || s === 'short')
    ),
  ];
  const pendingSides = [
    ...new Set(
      pendingOrders
        .map((o) => String(o.side).toLowerCase())
        .filter((s): s is LocalSide => s === 'long' || s === 'short')
    ),
  ];

  return {
    openUsd,
    pendingUsd,
    totalUsd,
    maxExposureUsd,
    remainingUsd: Math.max(0, maxExposureUsd - totalUsd),
    openSides,
    pendingSides,
  };
}

async function hasRecentPendingCancelCooldown(symbol: string): Promise<string | null> {
  const cooldownMin = getPendingOrderReentryCooldownMinutes();
  if (!(cooldownMin > 0)) return null;
  const since = new Date(Date.now() - cooldownMin * 60_000);
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
  const sym = symbol.toUpperCase();
  for (const ev of events) {
    if (!ev.event_data) {
      // BTC-only production: treat unscoped cancel as blocking.
      return `pending re-entry cooldown ${cooldownMin}m after cancel`;
    }
    try {
      const data = JSON.parse(ev.event_data) as { symbol?: string; order_id?: string };
      if (!data.symbol || String(data.symbol).toUpperCase().replace(/USDT$/i, '') === sym) {
        const ago = Math.ceil((Date.now() - ev.timestamp.getTime()) / 60_000);
        return `pending re-entry cooldown ${cooldownMin}m after cancel (${ago}m ago)`;
      }
    } catch {
      return `pending re-entry cooldown ${cooldownMin}m after cancel`;
    }
  }
  return null;
}

/**
 * Anti-chase: block same-side entry soon after a close (longer after a loss).
 */
export async function assertSameSidePostCloseCooldown(
  symbol: string,
  side: LocalSide,
  methodId = 'kim_nghia'
): Promise<string | null> {
  const winCd = getPostCloseSameSideCooldownMinutes(false);
  const lossCd = getPostCloseSameSideCooldownMinutes(true);
  const lookbackMin = Math.max(winCd, lossCd);
  if (!(lookbackMin > 0)) return null;

  const since = new Date(Date.now() - lookbackMin * 60_000);
  const sym = symbol.toUpperCase().replace(/USDT$/i, '');
  const recent = await prisma.testnetPosition.findFirst({
    where: {
      symbol: sym,
      side,
      status: 'closed',
      close_time: { gte: since },
      account: { method_id: methodId },
    },
    orderBy: { close_time: 'desc' },
    select: { close_time: true, realized_pnl: true, position_id: true },
  });
  if (!recent?.close_time) return null;

  const wasLoss = (recent.realized_pnl ?? 0) < -0.01;
  const cooldownMin = getPostCloseSameSideCooldownMinutes(wasLoss);
  if (!(cooldownMin > 0)) return null;

  const elapsedMin = (Date.now() - recent.close_time.getTime()) / 60_000;
  if (elapsedMin >= cooldownMin) return null;

  const left = Math.ceil(cooldownMin - elapsedMin);
  return (
    `same-side ${side} cooldown ${left}m after ${wasLoss ? 'loss' : 'close'} ` +
    `(${cooldownMin}m window)`
  );
}

export async function canRunLlmDispatchForSymbol(
  symbol: string,
  methodId = 'kim_nghia'
): Promise<{ allowed: boolean; reason: string }> {
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

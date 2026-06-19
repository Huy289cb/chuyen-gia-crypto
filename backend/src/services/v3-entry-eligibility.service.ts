/**
 * Shared entry eligibility for LLM dispatch and V3 execution (scale-in within exposure cap).
 */

import { getRiskPolicy } from '../config/risk-policy';
import { isV3ScaleInEnabled, resolveMaxTotalExposureUsd } from '../config/v3-entry-policy';
import { hasBinanceExposureForSide } from './binance-exposure.service';
import {
  getActiveTestnetPositions,
  getBlockingTestnetPendingOrders,
  getOrCreateTestnetAccount,
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

/**
 * Shared logic for Binance order fill price resolution and pending → position materialization.
 */

import {
  createTestnetPosition,
  executeTestnetPendingOrder,
  findTestnetPositionByBinanceOrderId,
  getTestnetPendingOrderByBinanceId,
  recordTestnetTradeEvent,
  updateTestnetPendingOrder,
} from '../repositories/testnet.repository';
import { prisma } from '../lib/prisma';
import {
  placeProtectiveOrdersForPosition,
  type ProtectivePlacementOutcome,
  resolveLevelsForFill,
} from './protective-order.service';
import { isBinanceOrderStateProbeUnavailable } from './binance-account-health.service';
import type { ParsedBinancePosition } from '../utils/binance-position-match';

/** Binance ORDER_TRADE_UPDATE `o` payload (subset). */
export interface BinanceOrderTradeUpdate {
  z?: string;
  Z?: string;
  ap?: string;
  L?: string;
  p?: string;
}

export function resolveFillAvgPrice(
  order: BinanceOrderTradeUpdate,
  executedQty: number,
  fallbackEntryPrice?: number
): number {
  const ap = parseFloat(order.ap ?? '');
  if (Number.isFinite(ap) && ap > 0) return ap;

  const lastFilled = parseFloat(order.L ?? '');
  if (Number.isFinite(lastFilled) && lastFilled > 0) return lastFilled;

  const qty = executedQty > 0 ? executedQty : parseFloat(order.z ?? '0');
  const quote = parseFloat(order.Z ?? '0');
  if (qty > 0 && Number.isFinite(quote) && quote > 0) return quote / qty;

  const limitPrice = parseFloat(order.p ?? '');
  if (Number.isFinite(limitPrice) && limitPrice > 0) return limitPrice;

  if (fallbackEntryPrice && Number.isFinite(fallbackEntryPrice) && fallbackEntryPrice > 0) {
    return fallbackEntryPrice;
  }

  return 0;
}

export function resolveFillQty(order: BinanceOrderTradeUpdate, executedQty: number): number {
  if (executedQty > 0) return executedQty;
  const z = parseFloat(order.z ?? '0');
  return Number.isFinite(z) && z > 0 ? z : 0;
}

/** Reconciliation may only materialize a fill this recent (WS miss window). Older = mark executed, no position. */
export const RECOVERY_FILL_MAX_AGE_MS = 15 * 60 * 1000;

export interface MaterializeFillOptions {
  suppressTelegram?: boolean;
  reconciliationBackfill?: boolean;
}

/** Skip duplicate "Mở vị thế" when WS already notified before a recovery pass. */
export async function hasEntryFillBeenNotified(orderId: string): Promise<boolean> {
  const { prisma: db } = await import('../lib/prisma');
  const recent = await db.testnetTradeEvent.findMany({
    where: { event_type: 'entry_order_filled' },
    orderBy: { timestamp: 'desc' },
    take: 80,
    select: { event_data: true },
  });
  for (const ev of recent) {
    if (!ev.event_data) continue;
    try {
      const data = JSON.parse(ev.event_data) as { order_id?: string };
      if (data.order_id === orderId) return true;
    } catch {
      /* skip malformed */
    }
  }
  return false;
}

async function markPendingExecutedWithoutPosition(
  localOrder: { order_id: string },
  avgPrice: number,
  qty: number,
  reason: string,
  linkPositionId?: string
): Promise<void> {
  if (linkPositionId) {
    await executeTestnetPendingOrder(localOrder.order_id, linkPositionId);
  } else {
    await updateTestnetPendingOrder(localOrder.order_id, {
      status: 'executed_historical',
      executed_at: new Date(),
      executed_price: avgPrice,
      executed_size_qty: qty,
      close_reason: reason,
    });
  }
  console.log(
    `[BinanceOrderFill] Pending ${localOrder.order_id} closed in ledger only (${reason})` +
      (linkPositionId ? ` linked=${linkPositionId}` : '')
  );
}

async function recordIncompleteProtectiveOutcome(
  positionId: string,
  outcome: ProtectivePlacementOutcome,
  context: string
): Promise<void> {
  if (outcome !== 'partial') return;
  await recordTestnetTradeEvent(positionId, 'protective_order_incomplete', {
    outcome,
    context,
    timestamp: new Date().toISOString(),
  });
}

async function findStrictActiveBinanceExposure(
  symbol: string,
  side: string
): Promise<ParsedBinancePosition | null> {
  try {
    const { fetchActiveBinancePositions } = await import('./binance-exposure.service');
    const active = await fetchActiveBinancePositions(symbol, {
      allowUserTradesFallback: false,
    });
    const base = String(symbol).toUpperCase().replace(/USDT$/i, '');
    const localSide = String(side).toLowerCase() === 'short' ? 'short' : 'long';
    return (
      active.find(
        (p) =>
          p.symbol === base &&
          p.side === localSide &&
          Number.isFinite(p.positionAmt) &&
          p.positionAmt > 1e-8
      ) ?? null
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[BinanceOrderFill] Active exposure probe failed for ${symbol}: ${message}`);
    return null;
  }
}

/**
 * Create open position from a filled pending order and place SL/TP on Binance.
 */
export async function materializePositionFromPendingFill(
  localOrder: {
    order_id: string;
    account_id: number;
    symbol: string;
    side: string;
    stop_loss: number;
    take_profit: number;
    risk_usd: number;
    risk_percent: number;
    expected_rr: number;
    linked_prediction_id?: number | null;
    binance_order_id?: string | null;
    entry_price?: number;
    status?: string;
  },
  executedQty: number,
  avgPrice: number,
  eventTime?: number,
  options?: MaterializeFillOptions
): Promise<string | null> {
  if (localOrder.binance_order_id) {
    const existing = await findTestnetPositionByBinanceOrderId(localOrder.binance_order_id);
    if (existing) {
      if (localOrder.status !== 'executed') {
        await executeTestnetPendingOrder(localOrder.order_id, existing.position_id);
      }
      const { prisma: db } = await import('../lib/prisma');
      const full = await db.testnetPosition.findUnique({
        where: { position_id: existing.position_id },
      });
      if (full) {
        const outcome = await placeProtectiveOrdersForPosition(full);
        await recordIncompleteProtectiveOutcome(
          existing.position_id,
          outcome,
          'existing_position_fill_link'
        );
      }
      return existing.position_id;
    }
  }

  if (!Number.isFinite(avgPrice) || avgPrice <= 0) {
    console.error(
      `[BinanceOrderFill] Invalid avgPrice for order ${localOrder.order_id}: ${avgPrice}`
    );
    return null;
  }

  const liveExposure = await findStrictActiveBinanceExposure(localOrder.symbol, localOrder.side);
  if (!liveExposure) {
    console.warn(
      `[BinanceOrderFill] Refuse materialize ${localOrder.order_id} — no live ${localOrder.side} exposure on Binance`
    );
    return null;
  }

  const qty = Math.abs(executedQty);
  if (!Number.isFinite(qty) || qty <= 0) {
    console.error(
      `[BinanceOrderFill] Invalid executedQty for order ${localOrder.order_id}: ${executedQty}`
    );
    return null;
  }

  const positionId = `pos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const sizeUsd = qty * avgPrice;

  const plannedEntry =
    Number(localOrder.entry_price) > 0 ? Number(localOrder.entry_price) : avgPrice;
  let mark: number | undefined;
  try {
    const { fetchBinanceNetPosition } = await import('./binance-exposure.service');
    const live = await fetchBinanceNetPosition(localOrder.symbol);
    if (live?.markPrice && live.markPrice > 0) mark = live.markPrice;
  } catch {
    /* optional */
  }
  const levels = resolveLevelsForFill(
    localOrder.side,
    avgPrice,
    plannedEntry,
    localOrder.stop_loss,
    localOrder.take_profit,
    mark
  );

  await createTestnetPosition({
    positionId,
    accountId: localOrder.account_id,
    symbol: localOrder.symbol,
    side: localOrder.side,
    entryPrice: avgPrice,
    stopLoss: levels.stop_loss,
    takeProfit: levels.take_profit,
    sizeUsd,
    sizeQty: qty,
    riskUsd: localOrder.risk_usd,
    riskPercent: localOrder.risk_percent,
    expectedRr: localOrder.expected_rr,
    linkedPredictionId: localOrder.linked_prediction_id ?? undefined,
    binanceOrderId: localOrder.binance_order_id ?? undefined,
    binanceSlOrderId: undefined,
    binanceTpOrderId: undefined,
    tpLevels: undefined,
    tpHitCount: 0,
    partialClosed: 0,
    entryFee: 0,
  });

  await executeTestnetPendingOrder(localOrder.order_id, positionId);

  let linkedDecisionId: number | undefined;
  try {
    const { prisma: db } = await import('../lib/prisma');
    const { PIPELINE_EVENT_POSITION_ID } = await import('../repositories/testnet.repository');
    const linkEvents = await db.testnetTradeEvent.findMany({
      where: {
        position_id: PIPELINE_EVENT_POSITION_ID,
        event_type: 'pending_order_linked',
      },
      orderBy: { timestamp: 'desc' },
      take: 30,
    });
    for (const ev of linkEvents) {
      if (!ev.event_data) continue;
      const data = JSON.parse(ev.event_data) as {
        order_id?: string;
        decision_id?: number;
      };
      if (data.order_id === localOrder.order_id && typeof data.decision_id === 'number') {
        linkedDecisionId = data.decision_id;
        break;
      }
    }
  } catch {
    /* non-fatal */
  }

  const { resolveTestnetAccountBalances } = await import('./binance-balance-sync.service');
  const balances = await resolveTestnetAccountBalances(localOrder.account_id);

  const entryAlreadyNotified = await hasEntryFillBeenNotified(localOrder.order_id);
  const skipEntryTelegram =
    options?.suppressTelegram === true ||
    options?.reconciliationBackfill === true ||
    entryAlreadyNotified;

  await recordTestnetTradeEvent(positionId, 'entry_order_filled', {
    order_id: localOrder.order_id,
    binance_order_id: localOrder.binance_order_id,
    symbol: localOrder.symbol,
    side: localOrder.side,
    entry_price: avgPrice,
    planned_entry: plannedEntry,
    stop_loss: levels.stop_loss,
    take_profit: levels.take_profit,
    executed_qty: qty,
    size_qty: qty,
    size_usd: sizeUsd,
    account_balance: balances.account_balance,
    account_equity: balances.account_equity,
    ...(skipEntryTelegram ? { suppress_telegram: true } : {}),
    ...(options?.reconciliationBackfill ? { reconciliation_backfill: true } : {}),
    timestamp: new Date(eventTime ?? Date.now()).toISOString(),
    ...(linkedDecisionId != null ? { decision_id: linkedDecisionId } : {}),
  });

  const { prisma: db } = await import('../lib/prisma');
  const created = await db.testnetPosition.findUnique({ where: { position_id: positionId } });
  if (created) {
    const outcome = await placeProtectiveOrdersForPosition(created);
    await recordIncompleteProtectiveOutcome(positionId, outcome, 'new_position_fill');
  }

  console.log(
    `[BinanceOrderFill] Position ${positionId} from order ${localOrder.order_id} @ ${avgPrice} SL=${levels.stop_loss} TP=${levels.take_profit}`
  );
  return positionId;
}

/**
 * Place SL/TP on Binance when missing (fill handler + reconciliation).
 */
export async function ensureProtectiveOrdersForPosition(position: {
  position_id: string;
  account_id?: number;
  symbol: string;
  side: string;
  entry_price?: number;
  size_qty: number;
  stop_loss: number;
  take_profit: number;
  binance_sl_order_id?: string | null;
  binance_tp_order_id?: string | null;
  account?: { current_balance?: number };
}): Promise<ProtectivePlacementOutcome> {
  const outcome = await placeProtectiveOrdersForPosition({
    ...position,
    entry_price: position.entry_price ?? 0,
  });
  await recordIncompleteProtectiveOutcome(
    position.position_id,
    outcome,
    'reconciliation_ensure'
  );
  return outcome;
}

/**
 * Recover a single pending row using Binance order query (reconciliation / repair).
 */
export async function recoverPendingOrderFromBinance(
  localOrder: {
    order_id: string;
    account_id: number;
    symbol: string;
    side: string;
    entry_price: number;
    stop_loss: number;
    take_profit: number;
    risk_usd: number;
    risk_percent: number;
    expected_rr: number;
    linked_prediction_id?: number | null;
    binance_order_id?: string | null;
    status: string;
  }
): Promise<'filled' | 'cancelled' | 'unchanged' | 'failed' | 'api_unavailable' | 'stale_skipped'> {
  if (!localOrder.binance_order_id) {
    return 'failed';
  }

  const { getOrder } = await import('./binance/trading');
  const symbol = `${localOrder.symbol}USDT`;

  try {
    const remote = await getOrder(symbol, Number(localOrder.binance_order_id));

    if (remote.status === 'FILLED') {
      const qty = remote.executedQty > 0 ? remote.executedQty : 0;
      let avg =
        qty > 0 && remote.cummulativeQuoteQty > 0
          ? remote.cummulativeQuoteQty / qty
          : remote.price;
      if (!Number.isFinite(avg) || avg <= 0) {
        avg = localOrder.entry_price;
      }

      const fillAgeMs = remote.updateTime ? Date.now() - remote.updateTime : Number.POSITIVE_INFINITY;
      const symbolBase = String(localOrder.symbol).toUpperCase();

      // Prefer existing local rows first; stale fills may still need protective recovery.
      const existingPos = localOrder.binance_order_id
        ? await findTestnetPositionByBinanceOrderId(localOrder.binance_order_id)
        : null;
      if (existingPos) {
        if (localOrder.status !== 'executed' && localOrder.status !== 'executed_historical') {
          await executeTestnetPendingOrder(localOrder.order_id, existingPos.position_id);
        }
        const full = await prisma.testnetPosition.findUnique({
          where: { position_id: existingPos.position_id },
        });
        if (full) {
          await ensureProtectiveOrdersForPosition(full);
        }
        return 'filled';
      }

      // ONE_WAY: at most one open local row per symbol.
      const openForSymbol = await prisma.testnetPosition.findFirst({
        where: { account_id: localOrder.account_id, symbol: symbolBase, status: 'open' },
      });
      if (openForSymbol) {
        await markPendingExecutedWithoutPosition(
          localOrder,
          avg,
          qty,
          'open_position_exists',
          openForSymbol.position_id
        );
        await ensureProtectiveOrdersForPosition(openForSymbol);
        return 'stale_skipped';
      }

      if (fillAgeMs > RECOVERY_FILL_MAX_AGE_MS) {
        const activeExposure = await findStrictActiveBinanceExposure(localOrder.symbol, localOrder.side);
        if (!activeExposure) {
          await markPendingExecutedWithoutPosition(localOrder, avg, qty, 'fill_too_old');
          return 'stale_skipped';
        }

        const recoveredQty = activeExposure.positionAmt > 0 ? activeExposure.positionAmt : qty;
        const recoveredAvg =
          activeExposure.entryPrice > 0
            ? activeExposure.entryPrice
            : avg > 0
              ? avg
              : localOrder.entry_price;
        console.warn(
          `[BinanceOrderFill] Old fill ${localOrder.order_id} still active on Binance; ` +
            `materializing for protective recovery qty=${recoveredQty} entry=${recoveredAvg}`
        );
        const positionId = await materializePositionFromPendingFill(
          {
            ...localOrder,
            entry_price: recoveredAvg,
          },
          recoveredQty,
          recoveredAvg,
          remote.updateTime,
          { reconciliationBackfill: true }
        );
        return positionId ? 'filled' : 'failed';
      }

      const activeExposure = await findStrictActiveBinanceExposure(
        localOrder.symbol,
        localOrder.side
      );
      if (!activeExposure) {
        const { wasRecentEmergencyMarketClose } = await import('./position-lifecycle-guard.service');
        const reason = wasRecentEmergencyMarketClose(localOrder.symbol, localOrder.side)
          ? 'fill_no_exposure_after_emergency_close'
          : 'fill_no_live_exposure';
        await markPendingExecutedWithoutPosition(localOrder, avg, qty, reason);
        console.warn(
          `[BinanceOrderFill] Skip materialize for ${localOrder.order_id} — FILLED but no live ${localOrder.side} on Binance (${reason})`
        );
        return 'stale_skipped';
      }

      const positionId = await materializePositionFromPendingFill(
        localOrder,
        qty,
        avg,
        remote.updateTime
      );
      return positionId ? 'filled' : 'failed';
    }

    if (remote.status === 'CANCELED' || remote.status === 'EXPIRED' || remote.status === 'REJECTED') {
      await updateTestnetPendingOrder(localOrder.order_id, {
        status: remote.status.toLowerCase(),
      });
      return 'cancelled';
    }

    if (remote.status === 'NEW' || remote.status === 'PARTIALLY_FILLED') {
      await updateTestnetPendingOrder(localOrder.order_id, { status: 'pending' });
      return 'unchanged';
    }

    return 'unchanged';
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (isBinanceOrderStateProbeUnavailable(error)) {
      console.warn(
        `[BinanceOrderFill] recover ${localOrder.order_id} deferred (Binance probe unavailable): ${message}`
      );
      return 'api_unavailable';
    }
    console.error(
      `[BinanceOrderFill] recover ${localOrder.order_id} failed:`,
      message
    );
    return 'failed';
  }
}

const WS_FILL_LOOKUP_RETRIES = 3;
const WS_FILL_LOOKUP_DELAY_MS = 500;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse x-v3_<ts>_<suffix> → v3_<ts>_<suffix> */
export function parseV3ClientOrderId(clientOrderId: string | undefined): string | null {
  if (!clientOrderId || typeof clientOrderId !== 'string') return null;
  const trimmed = clientOrderId.trim();
  if (trimmed.startsWith('x-v3_')) return trimmed.slice(2);
  if (trimmed.startsWith('x-') && trimmed.includes('v3_')) return trimmed.slice(2);
  if (trimmed.startsWith('v3_')) return trimmed;
  return null;
}

export async function findLocalOrderForBinanceEvent(
  binanceOrderId: string,
  symbolUsdt: string,
  clientOrderId?: string
): Promise<Awaited<ReturnType<typeof getTestnetPendingOrderByBinanceId>>> {
  const symbol = symbolUsdt.replace(/USDT/i, '').toUpperCase();
  const orderIdFromClient = parseV3ClientOrderId(clientOrderId);

  for (let attempt = 0; attempt < WS_FILL_LOOKUP_RETRIES; attempt++) {
    const byBinance = await getTestnetPendingOrderByBinanceId(binanceOrderId, symbol);
    if (byBinance) return byBinance;

    if (orderIdFromClient) {
      const { getTestnetPendingOrderByOrderId } = await import('../repositories/testnet.repository');
      const byOrderId = await getTestnetPendingOrderByOrderId(orderIdFromClient);
      if (byOrderId) return byOrderId;
    }

    if (attempt < WS_FILL_LOOKUP_RETRIES - 1) {
      await sleepMs(WS_FILL_LOOKUP_DELAY_MS);
    }
  }

  return null;
}

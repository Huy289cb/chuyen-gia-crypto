/**
 * Binance reconciliation — keep local DB aligned with Binance (ONE_WAY).
 *
 * Rules (simple):
 * 1. Real-time fills are created by WebSocket; reconciliation can recover live unprotected exposure.
 * 2. Reconciliation fixes pending status and only materializes old fills when Binance still has live exposure.
 * 3. Open positions: at most one local row per symbol; align qty with Binance net.
 * 4. Absent on Binance: bookkeeping PnL=0 for phantom rows; proven fills resolve PnL + notify.
 * 5. Never resurrect closed or mislabeled rows (prevents 62k ghost shorts).
 * 6. Close open rows older than 6h when absent on Binance (stale ghosts).
 * 7. Reconciliation uses positionRisk only — never userTrades net for open/reopen/close skip.
 */

import { prisma } from '../lib/prisma';
import {
  getTestnetPendingOrders,
  updateTestnetPendingOrder,
  getTestnetPositions,
  updateTestnetPosition,
  recordTestnetTradeEvent,
} from '../repositories/testnet.repository';
import {
  ensureProtectiveOrdersForPosition,
  recoverPendingOrderFromBinance,
} from './binance-order-fill.service';
import {
  fetchActiveBinancePositions,
  isBinancePositionRiskUnavailable,
} from './binance-exposure.service';
import { getOpenOrders, getOpenAlgoOrders, cancelAlgoOrder } from './binanceClient';
import { isPhantomReopenEnabled } from '../config/v3-entry-policy';
import { hasBinanceFillProof } from '../utils/binance-fill-proof';
import {
  type ParsedBinancePosition,
  type PositionSideLocal,
} from '../utils/binance-position-match';
import {
  checkBinanceAccountTradable,
  isBinanceAccountKnownUnhealthy,
  recordBinanceTradingAccessObserved,
} from './binance-account-health.service';

/**
 * Perform startup reconciliation between local DB and Binance
 * 
 * This should be called when the backend starts up if BINANCE_ENABLED=true
 */
export async function performStartupReconciliation(): Promise<void> {
  if (process.env.BINANCE_ENABLED !== 'true') {
    console.log('[BinanceReconciliation] BINANCE_ENABLED is not true, skipping reconciliation');
    return;
  }

  // Probe trading endpoints first — demo order/test often returns -1109 while openOrders works.
  try {
    await getOpenOrders({} as never, 'BTCUSDT');
    recordBinanceTradingAccessObserved('openOrders');
  } catch {
    /* softer demo gate in checkBinanceAccountTradable may still allow reconciliation */
  }

  if (isBinanceAccountKnownUnhealthy()) {
    return;
  }

  const accountHealth = await checkBinanceAccountTradable();
  if (!accountHealth.tradable) {
    console.warn(`[BinanceReconciliation] Skipped cycle: ${accountHealth.reason}`);
    return;
  }

  console.log('[BinanceReconciliation] Running reconciliation cycle...');

  try {
    // Pending: sync status only (cancel / mark executed). No backfill positions.
    await reconcilePendingOrders();
    await reconcileOrphanBinanceLimitOrders();
    await cleanupOrphanBinanceAlgoOrders('BTC');
    // Positions: align open rows with Binance net exposure (ONE_WAY).
    await reconcilePositions();
    
    console.log('[BinanceReconciliation] Reconciliation cycle completed successfully');
  } catch (error: any) {
    console.error('[BinanceReconciliation] Startup reconciliation failed:', error.message);
    // Don't throw - allow the backend to start even if reconciliation fails
    // The WebSocket sync will eventually correct any inconsistencies
  }
}

/**
 * Reconcile pending orders between local DB and Binance
 */
async function reconcilePendingOrders(): Promise<void> {
  console.log('[BinanceReconciliation] Reconciling pending orders...');

  const [localPendingOrders, localFailedOrders] = await Promise.all([
    getTestnetPendingOrders({ status: 'pending' }),
    getTestnetPendingOrders({ status: 'reconciliation_failed_not_on_binance' }),
  ]);

  if (localPendingOrders.length === 0 && localFailedOrders.length === 0) {
    console.log('[BinanceReconciliation] No local pending orders to reconcile');
    return;
  }

  const client = {} as any;
  const binanceOrders: any[] = [];
  const symbols = [
    ...new Set(
      [...localPendingOrders, ...localFailedOrders].map((o) => String(o.symbol).toUpperCase())
    ),
  ];
  const openOrdersOkBySymbol = new Map<string, boolean>();

  for (const sym of symbols) {
    try {
      const orders = await getOpenOrders(client, `${sym}USDT`);
      binanceOrders.push(...orders);
      openOrdersOkBySymbol.set(sym, true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      openOrdersOkBySymbol.set(sym, false);
      console.warn(
        `[BinanceReconciliation] openOrders unavailable for ${sym} (${message}) — ` +
          'keeping local pending state unchanged this cycle'
      );
    }
  }

  const binanceOrderIds = new Set(binanceOrders.map((o: any) => String(o.orderId)));

  for (const failed of localFailedOrders) {
    const sym = String(failed.symbol).toUpperCase();
    if (!openOrdersOkBySymbol.get(sym)) {
      continue;
    }
    if (failed.binance_order_id && binanceOrderIds.has(failed.binance_order_id)) {
      await updateTestnetPendingOrder(failed.order_id, { status: 'pending' });
      console.log(
        `[BinanceReconciliation] Relinked ${failed.order_id} to pending (found on Binance openOrders)`
      );
      continue;
    }
    const outcome = await recoverPendingOrderFromBinance(failed);
    if (outcome === 'api_unavailable') {
      console.warn(
        `[BinanceReconciliation] Deferred recovery for ${failed.order_id} (Binance probe unavailable)`
      );
    }
  }

  // Check each local pending order
  for (const localOrder of localPendingOrders) {
    const sym = String(localOrder.symbol).toUpperCase();
    if (!openOrdersOkBySymbol.get(sym)) {
      console.log(
        `[BinanceReconciliation] Skip ${localOrder.order_id}: openOrders probe failed for ${sym}`
      );
      continue;
    }

    if (!localOrder.binance_order_id) {
      // Local order without Binance ID - this shouldn't happen if BINANCE_ENABLED=true
      console.warn(`[BinanceReconciliation] Local order ${localOrder.order_id} has no binance_order_id, marking as failed`);
      await updateTestnetPendingOrder(localOrder.order_id, {
        status: 'failed_no_binance_id',
      });
      continue;
    }

    const existsOnBinance = binanceOrderIds.has(localOrder.binance_order_id);

    if (!existsOnBinance) {
      console.warn(
        `[BinanceReconciliation] Local order ${localOrder.order_id} (binance: ${localOrder.binance_order_id}) not in open orders — checking fill status`
      );
      const outcome = await recoverPendingOrderFromBinance(localOrder);
      if (outcome === 'filled') {
        console.log(`[BinanceReconciliation] Recovered filled order ${localOrder.order_id}`);
      } else if (outcome === 'cancelled') {
        console.log(`[BinanceReconciliation] Order ${localOrder.order_id} closed on Binance (${outcome})`);
      } else if (outcome === 'api_unavailable') {
        console.warn(
          `[BinanceReconciliation] Keep ${localOrder.order_id} pending — Binance order probe unavailable`
        );
      } else if (outcome === 'failed') {
        await updateTestnetPendingOrder(localOrder.order_id, {
          status: 'reconciliation_failed_not_on_binance',
        });
      }
    } else {
      // Order exists on both sides - verify status
      const binanceOrder = binanceOrders.find((o: any) => String(o.orderId) === localOrder.binance_order_id);
      if (binanceOrder) {
        const binanceStatus = binanceOrder.status;
        console.log(`[BinanceReconciliation] Order ${localOrder.order_id} exists on Binance with status ${binanceStatus}`);

        // If Binance shows FILLED but local shows pending, local state is stale
        if (binanceStatus === 'FILLED' && localOrder.status === 'pending') {
          console.warn(
            `[BinanceReconciliation] Order ${localOrder.order_id} FILLED on Binance but PENDING locally — recovering`
          );
          await recoverPendingOrderFromBinance(localOrder);
        }
      }
    }
  }

  // Check for orders on Binance that don't exist locally
  // This could happen if the order was placed but DB write failed
  for (const binanceOrder of binanceOrders) {
    const binanceOrderId = String(binanceOrder.orderId);
    const existsLocally = [...localPendingOrders, ...localFailedOrders].some(
      (o) => o.binance_order_id === binanceOrderId
    );

    if (!existsLocally) {
      console.warn(`[BinanceReconciliation] Binance order ${binanceOrderId} not found in local DB - orphaned order`);
      // Could create a local record for this order, but that's complex
      // For now, just log it - user can manually clean up
    }
  }
}

/**
 * Detect Binance GTC limit entry orders not tracked locally (DB write failed after place).
 */
async function reconcileOrphanBinanceLimitOrders(): Promise<void> {
  const client = {} as any;
  let binanceOrders: any[] = [];
  try {
    binanceOrders = await getOpenOrders(client, 'BTCUSDT');
  } catch (error: any) {
    console.error('[BinanceReconciliation] Failed to fetch BTC open orders:', error.message);
    return;
  }

  const limits = binanceOrders.filter(
    (o) => o.type === 'LIMIT' && (o.status === 'NEW' || o.status === 'PARTIALLY_FILLED')
  );
  if (limits.length === 0) return;

  const localPending = await getTestnetPendingOrders({ status: 'pending' });
  const localIds = new Set(localPending.map((o) => o.binance_order_id).filter(Boolean));

  for (const order of limits) {
    const binanceOrderId = String(order.orderId);
    if (localIds.has(binanceOrderId)) continue;

    console.warn(
      `[BinanceReconciliation] Orphan LIMIT on Binance id=${binanceOrderId} ` +
        `${order.side} @ ${order.price} qty=${order.quantity} — not in local DB`
    );
  }
}

const STALE_OPEN_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function collectProtectedAlgoIds(
  positions: Array<{ binance_sl_order_id?: string | null; binance_tp_order_id?: string | null }>
): Set<string> {
  const ids = new Set<string>();
  for (const position of positions) {
    if (position.binance_sl_order_id) ids.add(String(position.binance_sl_order_id));
    if (position.binance_tp_order_id) ids.add(String(position.binance_tp_order_id));
  }
  return ids;
}

/**
 * Cancel SL/TP algo orders when no matching open position on Binance.
 */
export async function cleanupOrphanBinanceAlgoOrders(symbol = 'BTC'): Promise<number> {
  const client = {} as any;
  const base = symbol.toUpperCase().replace(/USDT$/i, '');
  const pair = `${base}USDT`;

  const localOpen = await getTestnetPositions({ symbol: base, status: 'open' });
  if (localOpen.length > 0) {
    return 0;
  }

  const protectedAlgoIds = collectProtectedAlgoIds(localOpen);

  let activePositions: ParsedBinancePosition[] = [];
  try {
    activePositions = await fetchActiveBinancePositions(base);
  } catch {
    return 0;
  }

  if (isBinancePositionRiskUnavailable() && activePositions.length === 0) {
    return 0;
  }

  const hasExposure = activePositions.some(
    (p) => p.symbol === base && p.positionAmt >= 1e-8
  );
  if (hasExposure) return 0;

  let algoOrders: any[] = [];
  try {
    algoOrders = await getOpenAlgoOrders(client, pair);
  } catch (error: any) {
    console.warn(`[BinanceReconciliation] Algo order fetch failed: ${error.message}`);
    return 0;
  }

  if (algoOrders.length === 0) return 0;

  let cancelled = 0;
  for (const order of algoOrders) {
    const algoId = String(order.algoId ?? order.orderId);
    if (protectedAlgoIds.has(algoId)) {
      continue;
    }
    try {
      await cancelAlgoOrder(client, pair, algoId);
      cancelled += 1;
      console.log(
        `[BinanceReconciliation] Cancelled orphan algo ${order.orderType ?? order.type} algoId=${algoId}`
      );
    } catch (error: any) {
      console.warn(`[BinanceReconciliation] Failed to cancel algo ${algoId}: ${error.message}`);
    }
  }

  return cancelled;
}

/**
 * DB was closed by paper candle SL/TP simulation while Binance position is still open.
 */
async function reconcilePhantomLocalCloses(activeBinancePositions: ParsedBinancePosition[]): Promise<void> {
  if (!isPhantomReopenEnabled()) {
    return;
  }

  for (const bp of activeBinancePositions) {
    const symbol = bp.symbol;
    const side = bp.side;
    const amt = bp.positionAmt;
    if (!symbol || !side || amt < 1e-8) continue;

    const hasOpenLocal = await prisma.testnetPosition.findFirst({
      where: { symbol, side, status: 'open' },
    });
    if (hasOpenLocal) continue;

    const phantom = await prisma.testnetPosition.findFirst({
      where: {
        symbol,
        side,
        status: 'closed',
        close_reason: { in: ['take_profit', 'stop_loss'] },
        close_time: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      },
      orderBy: { close_time: 'desc' },
      include: { account: true },
    });

    if (!phantom) continue;

    const phantomPnl = Number(phantom.realized_pnl) || 0;
    const mark = bp.markPrice || phantom.entry_price;

    console.warn(
      `[BinanceReconciliation] Reopening phantom close ${phantom.position_id} ` +
        `(${symbol} ${side} still ${amt} on Binance)`
    );

    await updateTestnetPosition(phantom.position_id, {
      status: 'open',
      close_time: null,
      close_price: null,
      close_reason: null,
      realized_pnl: 0,
      unrealized_pnl: 0,
      current_price: mark,
      size_qty: side === 'short' ? -amt : amt,
      size_usd: Math.abs(amt * phantom.entry_price),
    });

    // Do not rewrite account win/loss counters — phantom close should not have credited PnL.
    // Balance is synced from Binance separately.

    await recordTestnetTradeEvent(phantom.position_id, 'reconciliation_reopened', {
      reason: 'phantom_close_reverted_position_only',
      binance_position_amt: amt,
      prior_phantom_pnl: phantomPnl,
    });
  }
}

/**
 * One canonical open row per symbol+side; merge duplicate open rows into the primary.
 */
async function consolidateLocalExposureWithBinance(
  activeBinance: ParsedBinancePosition[]
): Promise<void> {
  for (const bp of activeBinance) {
    const openLocals = await prisma.testnetPosition.findMany({
      where: { symbol: bp.symbol, side: bp.side, status: 'open' },
      orderBy: { entry_time: 'desc' },
    });

    if (openLocals.length > 1) {
      const [primary, ...dupes] = openLocals;
      const { closeDuplicateForMerge } = await import('./position-close.service');
      for (const dup of dupes) {
        await closeDuplicateForMerge(dup.position_id, primary.position_id);
      }
      await updateTestnetPosition(primary.position_id, {
        size_qty: bp.positionAmt,
        size_usd: bp.positionAmt * (bp.entryPrice || primary.entry_price),
        current_price: bp.markPrice || primary.entry_price,
      });
      await ensureProtectiveOrdersForPosition(primary);
      continue;
    }

    if (openLocals.length === 1) {
      const primary = openLocals[0];
      const qtyDiff = Math.abs(Number(primary.size_qty) - bp.positionAmt);
      if (qtyDiff > 0.0001) {
        await updateTestnetPosition(primary.position_id, {
          size_qty: bp.positionAmt,
          size_usd: bp.positionAmt * (bp.entryPrice || primary.entry_price),
          current_price: bp.markPrice || primary.entry_price,
        });
      }
      await ensureProtectiveOrdersForPosition(primary);
      continue;
    }

    console.warn(
      `[BinanceReconciliation] Binance ${bp.symbol} ${bp.side} ${bp.positionAmt} with no local open row — ` +
        'not reopening (WS/fill path only)'
    );
  }
}

/**
 * Close local row when Binance has no matching exposure (optional stale-ghost force).
 */
async function closeLocalIfAbsentOnBinance(
  localPosition: {
    position_id: string;
    symbol: string;
    side: string;
    entry_price?: number;
    size_qty?: number;
    stop_loss?: number;
    take_profit?: number;
    binance_sl_order_id?: string | null;
    binance_tp_order_id?: string | null;
    account_id?: number;
    account?: { current_balance?: number };
  },
  activeBinance: ParsedBinancePosition[],
  opts?: { staleGhost?: boolean }
): Promise<void> {
  const side = String(localPosition.side).toLowerCase() as PositionSideLocal;
  const bp = activeBinance.find((p) => p.symbol === localPosition.symbol && p.side === side);

  if (bp) return;

  if (isBinancePositionRiskUnavailable()) {
    console.warn(
      `[BinanceReconciliation] Local open ${localPosition.position_id} — positionRisk unavailable (-1109), skipping absent-on-Binance close`
    );
    await ensureProtectiveOrdersForPosition({
      position_id: localPosition.position_id,
      symbol: localPosition.symbol,
      side: localPosition.side,
      entry_price: localPosition.entry_price ?? 0,
      size_qty: localPosition.size_qty ?? 0,
      stop_loss: localPosition.stop_loss ?? 0,
      take_profit: localPosition.take_profit ?? 0,
      binance_sl_order_id: localPosition.binance_sl_order_id,
      binance_tp_order_id: localPosition.binance_tp_order_id,
      account_id: localPosition.account_id,
      account: localPosition.account,
    });
    return;
  }

  const label = opts?.staleGhost ? 'stale ghost' : 'absent on Binance';
  console.warn(
    `[BinanceReconciliation] Local open ${localPosition.position_id} ${label} — evaluating close`
  );

  const { closeLocalPosition } = await import('./position-close.service');
  const full = await prisma.testnetPosition.findUnique({
    where: { position_id: localPosition.position_id },
    include: { account: true },
  });
  if (!full || full.status !== 'open' || !full.account) return;

  const closePrice = full.current_price > 0 ? full.current_price : full.entry_price;
  const closeReason = opts?.staleGhost ? 'stale_ghost_open' : 'reconciliation_closed_not_on_binance';
  const provenFill = hasBinanceFillProof(full);

  console.warn(
    `[BinanceReconciliation] Closing ${full.position_id} (${label}) — ` +
      (provenFill ? 'proven fill, resolve PnL from Binance' : 'bookkeeping PnL=0, wallet from Binance')
  );

  await closeLocalPosition(
    { ...full, account: { current_balance: full.account.current_balance } },
    closePrice,
    closeReason,
    {
      verified_binance_zero: true,
      ...(!provenFill ? { bookkeeping_close: true } : {}),
      ...(opts?.staleGhost ? { stale_ghost: true } : {}),
    }
  );
}

async function forceCloseStaleGhost(local: {
  position_id: string;
}): Promise<void> {
  const { closeLocalPosition } = await import('./position-close.service');
  const full = await prisma.testnetPosition.findUnique({
    where: { position_id: local.position_id },
    include: { account: true },
  });
  if (!full || full.status !== 'open' || !full.account) return;

  const closePrice = full.current_price > 0 ? full.current_price : full.entry_price;
  const provenFill = hasBinanceFillProof(full);
  console.warn(
    `[BinanceReconciliation] Force-closing stale ghost ${full.position_id} ` +
      `(entry ${full.entry_time?.toISOString()} @ ${full.entry_price})` +
      (provenFill ? ' — proven fill, resolve PnL' : ' — bookkeeping')
  );

  await closeLocalPosition(
    { ...full, account: { current_balance: full.account.current_balance } },
    closePrice,
    'stale_ghost_open',
    {
      stale_ghost: true,
      verified_binance_zero: true,
      ...(!provenFill ? { bookkeeping_close: true } : {}),
    }
  );
}

async function closeStaleOpenPositions(activeBinance: ParsedBinancePosition[]): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_OPEN_MAX_AGE_MS);
  const staleOpens = await prisma.testnetPosition.findMany({
    where: { status: 'open', entry_time: { lt: cutoff } },
  });

  for (const local of staleOpens) {
    const side = String(local.side).toLowerCase() as PositionSideLocal;
    const bp = activeBinance.find((p) => p.symbol === local.symbol && p.side === side);
    if (bp && bp.positionAmt >= 1e-8) {
      console.log(
        `[BinanceReconciliation] Skip stale ghost ${local.position_id} — still ${bp.positionAmt} on Binance`
      );
      continue;
    }

    if (hasBinanceFillProof(local) && isBinancePositionRiskUnavailable()) {
      console.warn(
        `[BinanceReconciliation] Skip stale ghost ${local.position_id} — fill proof + positionRisk unavailable`
      );
      continue;
    }

    await forceCloseStaleGhost(local);
  }
}

/**
 * Reconcile positions between local DB and Binance (ONE_WAY positionSide BOTH aware).
 */
async function reconcilePositions(): Promise<void> {
  console.log('[BinanceReconciliation] Reconciling positions...');

  let activeBinance: ParsedBinancePosition[] = [];
  try {
    activeBinance = await fetchActiveBinancePositions(undefined, {
      allowUserTradesFallback: false,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[BinanceReconciliation] Failed to fetch Binance positions:', message);
    return;
  }

  await reconcilePhantomLocalCloses(activeBinance);
  await consolidateLocalExposureWithBinance(activeBinance);
  await closeStaleOpenPositions(activeBinance);

  const localOpen = await getTestnetPositions({ status: 'open' });

  for (const localPosition of localOpen) {
    await closeLocalIfAbsentOnBinance(localPosition, activeBinance);
    const side = String(localPosition.side).toLowerCase() as PositionSideLocal;
    const bp = activeBinance.find((p) => p.symbol === localPosition.symbol && p.side === side);

    if (!bp) {
      continue;
    }

    const qtyDiff = Math.abs(Number(localPosition.size_qty) - bp.positionAmt);
    if (qtyDiff > 0.0001) {
      await updateTestnetPosition(localPosition.position_id, {
        size_qty: bp.positionAmt,
        size_usd: bp.positionAmt * (bp.entryPrice || localPosition.entry_price),
        current_price: bp.markPrice || localPosition.current_price,
      });
    }

    await ensureProtectiveOrdersForPosition(localPosition);
  }
}

/**
 * Initialize the startup reconciliation
 * This should be called when the backend starts
 */
export async function initializeBinanceReconciliation(): Promise<void> {
  if (process.env.BINANCE_ENABLED !== 'true') {
    return;
  }

  // Wait a bit for the backend to fully start
  setTimeout(async () => {
    await performStartupReconciliation();
  }, 5000); // 5 seconds delay

  // Start periodic recovery polling
  startPeriodicReconciliation();
}

let periodicReconciliationInterval: NodeJS.Timeout | null = null;

/**
 * Start periodic reconciliation polling
 * Runs every 60 seconds to verify local state matches Binance
 */
function startPeriodicReconciliation(): void {
  if (periodicReconciliationInterval) {
    return; // Already running
  }

  console.log('[BinanceReconciliation] Starting periodic reconciliation polling (60s interval)');

  periodicReconciliationInterval = setInterval(async () => {
    try {
      await performStartupReconciliation();
    } catch (error: any) {
      console.error('[BinanceReconciliation] Periodic reconciliation failed:', error.message);
    }
  }, 60000); // 60 seconds
}

/**
 * Stop periodic reconciliation polling
 */
export function stopPeriodicReconciliation(): void {
  if (periodicReconciliationInterval) {
    clearInterval(periodicReconciliationInterval);
    periodicReconciliationInterval = null;
    console.log('[BinanceReconciliation] Periodic reconciliation polling stopped');
  }
}

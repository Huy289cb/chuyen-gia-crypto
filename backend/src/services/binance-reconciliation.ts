/**
 * Binance Futures Startup Reconciliation Service
 * 
 * Syncs local database state with Binance state on backend startup
 * Handles server crashes, restarts, network failures, missed WebSocket events
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
  fetchBinancePositionRiskRows,
} from './binance-exposure.service';
import { getOpenOrders } from './binanceClient';
import { isPhantomReopenEnabled } from '../config/v3-entry-policy';
import {
  findBinancePositionForSide,
  type ParsedBinancePosition,
  type PositionSideLocal,
} from '../utils/binance-position-match';

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

  console.log('[BinanceReconciliation] Starting startup reconciliation...');

  try {
    await reconcilePendingOrders();
    await recoverMislabeledPendingOrders();
    await reconcileExecutedOrdersMissingPositions();
    await reconcilePositions();
    
    console.log('[BinanceReconciliation] Startup reconciliation completed successfully');
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

  const localPendingOrders = await getTestnetPendingOrders({ status: 'pending' });
  
  if (localPendingOrders.length === 0) {
    console.log('[BinanceReconciliation] No local pending orders to reconcile');
    return;
  }

  const client = {} as any; // Binance client is not needed for module functions

  // Fetch open orders from Binance
  const binanceOrders: any[] = [];
  for (const order of localPendingOrders) {
    try {
      const orders = await getOpenOrders(client, `${order.symbol}USDT`);
      binanceOrders.push(...orders);
    } catch (error: any) {
      console.error(`[BinanceReconciliation] Failed to fetch open orders for ${order.symbol}:`, error.message);
    }
  }

  // Create a map of Binance order IDs for quick lookup
  const binanceOrderIds = new Set(binanceOrders.map((o: any) => String(o.orderId)));

  // Check each local pending order
  for (const localOrder of localPendingOrders) {
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
    const existsLocally = localPendingOrders.some(o => o.binance_order_id === binanceOrderId);
    
    if (!existsLocally) {
      console.warn(`[BinanceReconciliation] Binance order ${binanceOrderId} not found in local DB - orphaned order`);
      // Could create a local record for this order, but that's complex
      // For now, just log it - user can manually clean up
    }
  }
}

/**
 * Retry orders previously marked reconciliation_failed (e.g. filled while WS had NaN price).
 */
async function recoverMislabeledPendingOrders(): Promise<void> {
  const stale = await prisma.testnetPendingOrder.findMany({
    where: { status: 'reconciliation_failed_not_on_binance' },
    orderBy: { created_at: 'desc' },
    take: 20,
  });

  if (stale.length === 0) return;

  console.log(`[BinanceReconciliation] Recovering ${stale.length} mislabeled pending order(s)...`);

  for (const localOrder of stale) {
    const outcome = await recoverPendingOrderFromBinance(localOrder);
    console.log(`[BinanceReconciliation] Recover ${localOrder.order_id}: ${outcome}`);
  }
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
 * Executed pending rows with no open / recoverable local position (missed WS fill).
 */
async function reconcileExecutedOrdersMissingPositions(): Promise<void> {
  const executed = await prisma.testnetPendingOrder.findMany({
    where: { status: 'executed' },
    orderBy: { executed_at: 'desc' },
    take: 20,
  });

  for (const order of executed) {
    if (!order.binance_order_id) continue;

    const existing = await prisma.testnetPosition.findFirst({
      where: { binance_order_id: order.binance_order_id },
    });
    if (existing) continue;

    const openForSymbol = await prisma.testnetPosition.findFirst({
      where: {
        symbol: order.symbol,
        side: order.side,
        status: { in: ['open', 'reconciliation_failed_not_on_binance'] },
      },
    });
    if (openForSymbol) continue;

    const outcome = await recoverPendingOrderFromBinance(order);
    if (outcome === 'filled') {
      console.log(
        `[BinanceReconciliation] Materialized position from executed pending ${order.order_id}`
      );
    }
  }
}

/**
 * Re-open rows wrongly marked reconciliation_failed when Binance still has exposure.
 */
async function recoverMislabeledLocalPositions(): Promise<void> {
  const mislabeled = await prisma.testnetPosition.findMany({
    where: { status: 'reconciliation_failed_not_on_binance' },
    orderBy: { entry_time: 'desc' },
  });

  let riskRows: Awaited<ReturnType<typeof fetchBinancePositionRiskRows>> = [];
  try {
    riskRows = await fetchBinancePositionRiskRows();
  } catch {
    return;
  }

  for (const local of mislabeled) {
    const side = String(local.side).toLowerCase() as PositionSideLocal;
    const bp = findBinancePositionForSide(riskRows, local.symbol, side);

    if (!bp) continue;

    console.warn(
      `[BinanceReconciliation] Reopening mislabeled position ${local.position_id} (${local.symbol} ${side})`
    );

    await updateTestnetPosition(local.position_id, {
      status: 'open',
      size_qty: bp.positionAmt,
      size_usd: bp.positionAmt * (bp.entryPrice || local.entry_price),
      current_price: bp.markPrice || local.entry_price,
      unrealized_pnl: 0,
    });

    await ensureProtectiveOrdersForPosition(local);
  }
}

/**
 * One canonical open row per symbol+side; merge duplicate mislabeled rows into the primary.
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

    const mislabeled = await prisma.testnetPosition.findMany({
      where: {
        symbol: bp.symbol,
        side: bp.side,
        status: 'reconciliation_failed_not_on_binance',
      },
      orderBy: { entry_time: 'desc' },
    });

    if (mislabeled.length === 0) {
      console.warn(
        `[BinanceReconciliation] Binance ${bp.symbol} ${bp.side} ${bp.positionAmt} with no local open row`
      );
      continue;
    }

    const [primary, ...dupes] = mislabeled;
    await updateTestnetPosition(primary.position_id, {
      status: 'open',
      size_qty: bp.positionAmt,
      size_usd: bp.positionAmt * (bp.entryPrice || primary.entry_price),
      current_price: bp.markPrice || primary.entry_price,
      unrealized_pnl: 0,
      close_time: null,
      close_price: null,
      close_reason: null,
    });

    const { closeDuplicateForMerge } = await import('./position-close.service');
    for (const dup of dupes) {
      await closeDuplicateForMerge(dup.position_id, primary.position_id);
    }

    await ensureProtectiveOrdersForPosition(primary);
    console.log(
      `[BinanceReconciliation] Consolidated ${mislabeled.length} mislabeled row(s) → ${primary.position_id}`
    );
  }
}

/**
 * Reconcile positions between local DB and Binance (ONE_WAY positionSide BOTH aware).
 */
async function reconcilePositions(): Promise<void> {
  console.log('[BinanceReconciliation] Reconciling positions...');

  let activeBinance: ParsedBinancePosition[] = [];
  try {
    activeBinance = await fetchActiveBinancePositions();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[BinanceReconciliation] Failed to fetch Binance positions:', message);
    return;
  }

  await reconcilePhantomLocalCloses(activeBinance);
  await recoverMislabeledLocalPositions();
  await consolidateLocalExposureWithBinance(activeBinance);

  const localOpen = await getTestnetPositions({ status: 'open' });

  for (const localPosition of localOpen) {
    const side = String(localPosition.side).toLowerCase() as PositionSideLocal;
    const bp = activeBinance.find((p) => p.symbol === localPosition.symbol && p.side === side);

    if (!bp) {
      console.warn(
        `[BinanceReconciliation] Local open ${localPosition.position_id} absent on Binance — closing with PnL`
      );
      const { closeLocalPosition } = await import('./position-close.service');
      const full = await prisma.testnetPosition.findUnique({
        where: { position_id: localPosition.position_id },
        include: { account: true },
      });
      if (full && full.status === 'open' && full.account) {
        const closePrice =
          full.current_price > 0 ? full.current_price : full.entry_price;
        await closeLocalPosition(
          {
            ...full,
            account: { current_balance: full.account.current_balance },
          },
          closePrice,
          'reconciliation_closed_not_on_binance',
          { verified_binance_zero: true }
        );
      }
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

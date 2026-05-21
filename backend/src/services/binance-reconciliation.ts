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
import { recoverPendingOrderFromBinance } from './binance-order-fill.service';
import { getOpenOrders, getPositionRisk } from './binanceClient';

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
async function reconcilePhantomLocalCloses(activeBinancePositions: any[]): Promise<void> {
  for (const bp of activeBinancePositions) {
    const symbol = String(bp.symbol || '').replace('USDT', '');
    const positionSide = String(bp.positionSide || '').toUpperCase();
    const side = positionSide === 'LONG' ? 'long' : positionSide === 'SHORT' ? 'short' : null;
    const amt = Math.abs(parseFloat(bp.positionAmt ?? '0'));
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
    const mark = parseFloat(bp.markPrice) || phantom.entry_price;

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
 * Reconcile positions between local DB and Binance
 */
async function reconcilePositions(): Promise<void> {
  console.log('[BinanceReconciliation] Reconciling positions...');

  const localPositions = await getTestnetPositions({ status: 'open' });
  const recentClosed = await prisma.testnetPosition.findMany({
    where: { close_time: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) } },
    select: { symbol: true },
  });
  const symbols = [
    ...new Set([
      ...localPositions.map((p) => p.symbol),
      ...recentClosed.map((p) => p.symbol),
      'BTC',
    ]),
  ];

  const client = {} as any; // Binance client is not needed for module functions

  const binancePositions: any[] = [];
  for (const symbol of symbols) {
    try {
      const positions = await getPositionRisk(client, `${symbol}USDT`);
      binancePositions.push(...positions);
    } catch (error: any) {
      console.error(`[BinanceReconciliation] Failed to fetch position risk for ${symbol}:`, error.message);
    }
  }

  const activeBinancePositions = binancePositions.filter((p: any) => parseFloat(p.positionAmt) !== 0);

  await reconcilePhantomLocalCloses(activeBinancePositions);

  if (localPositions.length === 0) {
    console.log('[BinanceReconciliation] No local open positions to reconcile');
    return;
  }

  // Create a map for quick lookup
  const binancePositionMap = new Map(
    activeBinancePositions.map((p: any) => [`${p.symbol}_${p.positionSide}`, p])
  );

  // Check each local position
  for (const localPosition of localPositions) {
    const positionSide = localPosition.side === 'long' ? 'LONG' : 'SHORT';
    const key = `${localPosition.symbol}USDT_${positionSide}`;
    
    const binancePosition = binancePositionMap.get(key);

    if (!binancePosition) {
      // Position exists locally but not on Binance
      // Possible scenarios:
      // 1. Position was closed while backend was down
      // 2. Position was never opened on Binance
      // 3. Position side mismatch
      
      console.warn(`[BinanceReconciliation] Local position ${localPosition.position_id} not found on Binance`);
      
      // Mark as potentially closed - user should verify
      await updateTestnetPosition(localPosition.position_id, {
        status: 'reconciliation_failed_not_on_binance',
      });
    } else {
      // Position exists on both sides - verify details
      const binanceAmt = parseFloat(binancePosition.positionAmt);
      const localAmt = localPosition.size_qty;
      
      // Check if quantities match approximately (allow for small rounding differences)
      const qtyDiff = Math.abs(binanceAmt - localAmt);
      if (qtyDiff > 0.0001) {
        console.warn(`[BinanceReconciliation] Position ${localPosition.position_id} quantity mismatch: local=${localAmt}, binance=${binanceAmt}`);
        await updateTestnetPosition(localPosition.position_id, {
          size_qty: binanceAmt,
          size_usd: binanceAmt * localPosition.entry_price,
        });
      }
      
      console.log(`[BinanceReconciliation] Position ${localPosition.position_id} reconciled successfully`);
    }
  }

  // Check for positions on Binance that don't exist locally
  for (const [key, binancePosition] of binancePositionMap) {
    const symbol = binancePosition.symbol.replace('USDT', '');
    const positionSide = binancePosition.positionSide.toLowerCase();
    const side = positionSide === 'long' ? 'long' : 'short';
    
    const existsLocally = localPositions.some(
      p => p.symbol === symbol && p.side === side && p.status === 'open'
    );
    
    if (!existsLocally) {
      console.warn(`[BinanceReconciliation] Binance position ${key} not found in local DB - orphaned position`);
      // Could create a local record for this position, but that's complex
      // For now, just log it - user can manually clean up
    }
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

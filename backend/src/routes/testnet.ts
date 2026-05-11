/**
 * Testnet Routes backed by Prisma + Neon/Postgres
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';

// @ts-ignore - JS module, will be migrated later
import {
  cancelTestnetPendingOrder,
  getTestnetAccountSnapshots,
  getTestnetPendingOrders,
  getTestnetPerformanceMetrics,
  getTestnetPositions,
  getTestnetTradeEvents,
  getTestnetPosition,
  resetPrecisionErrorTracking,
} from '../repositories/testnet.repository';

const router = Router();

// Extend Express Request to include prisma
declare global {
  namespace Express {
    interface Request {
      prisma?: typeof prisma;
    }
  }
}

function parsePositiveInt(value: any, fallback: number | null = null): number | null {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function calculatePnl(side: string, entryPrice: number, closePrice: number, sizeQty: number): number {
  const raw = (closePrice - entryPrice) * sizeQty;
  return String(side).toLowerCase() === 'long' ? raw : -raw;
}

async function getBinanceHelpers() {
  return import('../services/binanceClient.js');
}

router.get('/accounts', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;
  if (!prismaClient) {
    return res.status(503).json({ success: false, error: 'Database not available' });
  }

  try {
    const accounts = await prismaClient.testnetAccount.findMany({
      orderBy: { created_at: 'desc' },
    });

    return res.json({
      success: true,
      data: accounts,
      meta: { count: accounts.length },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/positions', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;
  if (!prismaClient) {
    return res.status(503).json({ success: false, error: 'Database not available' });
  }

  const { status, account_id } = req.query;
  const filters: any = {};
  const accountId = parsePositiveInt(account_id);

  if (status) filters.status = String(Array.isArray(status) ? status[0] : status);
  if (accountId) filters.accountId = accountId;

  try {
    const positions = await getTestnetPositions(filters);
    return res.json({
      success: true,
      data: positions,
      meta: { count: positions.length, filters },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/positions/:id', async (req: Request, res: Response) => {
  try {
    const position = await getTestnetPosition(String(req.params.id));
    if (!position) {
      return res.status(404).json({ success: false, error: 'Position not found' });
    }

    const events = await getTestnetTradeEvents(String(req.params.id));
    return res.json({
      success: true,
      data: {
        ...position,
        events,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/performance/:accountId', async (req: Request, res: Response) => {
  const accountId = parsePositiveInt(req.params.accountId);
  if (!accountId) {
    return res.status(400).json({ success: false, error: 'Invalid account id' });
  }

  try {
    const metrics = await getTestnetPerformanceMetrics(accountId);
    if (!metrics) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }

    return res.json({
      success: true,
      data: metrics,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/equity-curve/:accountId', async (req: Request, res: Response) => {
  const accountId = parsePositiveInt(req.params.accountId);
  if (!accountId) {
    return res.status(400).json({ success: false, error: 'Invalid account id' });
  }

  try {
    const limit = parsePositiveInt(req.query.limit, 100);
    const snapshots = await getTestnetAccountSnapshots(accountId, limit || 100);
    return res.json({
      success: true,
      data: snapshots,
      meta: { count: snapshots.length, limit: limit || 100 },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/trades/:accountId', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;
  const accountId = parsePositiveInt(req.params.accountId);
  if (!prismaClient) {
    return res.status(503).json({ success: false, error: 'Database not available' });
  }
  if (!accountId) {
    return res.status(400).json({ success: false, error: 'Invalid account id' });
  }

  try {
    const limit = parsePositiveInt(req.query.limit, 50);
    const positions = await prismaClient.testnetPosition.findMany({
      where: {
        account_id: accountId,
        close_time: { not: null },
      },
      orderBy: { close_time: 'desc' },
      take: limit || 50,
    });

    return res.json({
      success: true,
      data: positions,
      meta: { count: positions.length, limit: limit || 50 },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/reset/:accountId', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;
  const accountId = parsePositiveInt(req.params.accountId);
  if (!prismaClient) {
    return res.status(503).json({ success: false, error: 'Database not available' });
  }
  if (!accountId) {
    return res.status(400).json({ success: false, error: 'Invalid account id' });
  }

  try {
    const account = await prismaClient.testnetAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }

    await prismaClient.$transaction([
      prismaClient.testnetPendingOrder.deleteMany({ where: { account_id: accountId } }),
      prismaClient.testnetTradeEvent.deleteMany({
        where: {
          position: {
            account_id: accountId,
          },
        },
      }),
      prismaClient.testnetPosition.deleteMany({ where: { account_id: accountId } }),
      prismaClient.testnetAccountSnapshot.deleteMany({ where: { account_id: accountId } }),
      prismaClient.testnetAccount.update({
        where: { id: accountId },
        data: {
          current_balance: account.starting_balance,
          equity: account.starting_balance,
          unrealized_pnl: 0,
          realized_pnl: 0,
          total_trades: 0,
          winning_trades: 0,
          losing_trades: 0,
          max_drawdown: 0,
          consecutive_losses: 0,
          last_trade_time: null,
          cooldown_until: null,
          updated_at: new Date(),
        },
      }),
    ]);

    return res.json({
      success: true,
      message: 'Testnet account reset successfully',
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/sync/:accountId', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;
  const accountId = parsePositiveInt(req.params.accountId);
  if (!prismaClient) {
    return res.status(503).json({ success: false, error: 'Database not available' });
  }
  if (!accountId) {
    return res.status(400).json({ success: false, error: 'Invalid account id' });
  }

  try {
    const account = await prismaClient.testnetAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      return res.status(404).json({ success: false, error: 'Testnet account not found' });
    }

    const { initTestnetClient, getAccountBalance } = await getBinanceHelpers();
    const client = initTestnetClient();
    if (!client) {
      return res.status(503).json({
        success: false,
        error: 'Testnet client not initialized',
      });
    }

    const balance: any = await getAccountBalance(client);
    const walletBalance = Number(balance.walletBalance || balance.availableBalance || 0);
    const unrealizedPnl = Number(balance.totalUnrealizedProfit || 0);
    const equity = Number(balance.totalWalletBalance || walletBalance + unrealizedPnl);

    await prismaClient.testnetAccount.update({
      where: { id: accountId },
      data: {
        current_balance: walletBalance,
        equity,
        unrealized_pnl: unrealizedPnl,
        // Fix: On first sync (no trades yet), set starting_balance to actual Binance balance
        // so Total Return calculates correctly instead of using default 100
        ...(account.total_trades === 0 && { starting_balance: walletBalance }),
        updated_at: new Date(),
      },
    });

    await prismaClient.testnetAccountSnapshot.create({
      data: {
        account_id: accountId,
        balance: walletBalance,
        equity,
        unrealized_pnl: unrealizedPnl,
        realized_pnl: account.realized_pnl,
        open_positions_count: await prismaClient.testnetPosition.count({
          where: { account_id: accountId, status: 'open' },
        }),
      },
    });

    return res.json({
      success: true,
      message: 'Testnet account synced successfully',
      data: {
        balance: walletBalance,
        equity,
        unrealized_pnl: unrealizedPnl,
        synced_at: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/balance', async (_req: Request, res: Response) => {
  try {
    const { initTestnetClient, getAccountBalance } = await getBinanceHelpers();
    const client = initTestnetClient();
    if (!client) {
      return res.status(503).json({ success: false, error: 'Testnet client not initialized' });
    }

    const balance: any = await getAccountBalance(client);
    return res.json({
      success: true,
      data: {
        wallet_balance: balance.walletBalance,
        available_balance: balance.availableBalance,
        total_wallet_balance: balance.totalWalletBalance,
        total_unrealized_profit: balance.totalUnrealizedProfit,
        fetched_at: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/cleanup/:accountId', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;
  const accountId = parsePositiveInt(req.params.accountId);
  if (!prismaClient) {
    return res.status(503).json({ success: false, error: 'Database not available' });
  }
  if (!accountId) {
    return res.status(400).json({ success: false, error: 'Invalid account id' });
  }

  try {
    const pendingOrders = await prismaClient.testnetPendingOrder.findMany({
      where: {
        account_id: accountId,
        status: 'pending',
      },
    });

    let client: any = null;
    let cancelOrder: any = null;
    
    if (process.env.BINANCE_ENABLED === 'true') {
      try {
        const helpers: any = await getBinanceHelpers();
        client = helpers.initTestnetClient();
        cancelOrder = helpers.cancelOrder;
        if (!client) {
          console.error('[TestnetRoutes] Binance client unavailable for cleanup');
          return res.status(503).json({ 
            success: false, 
            error: 'Binance client unavailable - cannot cancel real orders' 
          });
        }
      } catch (error: any) {
        console.error('[TestnetRoutes] Failed to initialize Binance client for cleanup:', error.message);
        return res.status(503).json({ 
          success: false, 
          error: `Binance client initialization failed: ${error.message}` 
        });
      }
    }

    const cancelledOrderIds: number[] = [];
    const binanceCancelErrors: any[] = [];

    for (const order of pendingOrders) {
      // Binance-first: Cancel Binance order first
      if (process.env.BINANCE_ENABLED === 'true' && client && cancelOrder && order.binance_order_id) {
        try {
          console.log(`[TestnetRoutes] Cleanup: Cancelling Binance order ${order.binance_order_id} for local order ${order.order_id}`);
          await cancelOrder(client, `${order.symbol}USDT`, Number(order.binance_order_id));
          console.log(`[TestnetRoutes] Cleanup: Binance order ${order.binance_order_id} cancelled successfully`);
        } catch (error: any) {
          console.error(`[TestnetRoutes] Cleanup: Failed to cancel Binance order ${order.binance_order_id}:`, error.message);
          binanceCancelErrors.push({
            order_id: order.order_id,
            binance_order_id: order.binance_order_id,
            error: error.message,
          });
          // Continue with other orders even if one fails
        }
      }

      // Only update local DB after Binance cancellation (or if BINANCE_ENABLED is false)
      await cancelTestnetPendingOrder(String(order.order_id), 'cleanup');
      cancelledOrderIds.push(Number(order.order_id));
    }

    const account = await prismaClient.testnetAccount.findUnique({ where: { id: accountId } });
    if (account) {
      await prismaClient.testnetAccountSnapshot.create({
        data: {
          account_id: accountId,
          balance: account.current_balance,
          equity: account.equity,
          unrealized_pnl: account.unrealized_pnl,
          realized_pnl: account.realized_pnl,
          open_positions_count: await prismaClient.testnetPosition.count({
            where: { account_id: accountId, status: 'open' },
          }),
        },
      });
    }

    return res.json({
      success: binanceCancelErrors.length === 0,
      message: binanceCancelErrors.length > 0 
        ? 'Testnet cleanup completed with some Binance cancellation errors' 
        : 'Testnet cleanup completed successfully',
      data: {
        cancelled_order_ids: cancelledOrderIds,
        wallet_balance: account?.current_balance ?? null,
        equity: account?.equity ?? null,
        unrealized_pnl: account?.unrealized_pnl ?? null,
        cleaned_at: new Date().toISOString(),
        binance_cancel_errors: binanceCancelErrors.length > 0 ? binanceCancelErrors : undefined,
      },
    });
  } catch (error: any) {
    console.error('[TestnetRoutes] Error during cleanup:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/positions/:id/close', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;
  if (!prismaClient) {
    return res.status(503).json({ success: false, error: 'Database not available' });
  }

  const { id } = req.params;
  const { reason = 'manual' } = req.body;
  const closeReason = Array.isArray(reason) ? reason[0] : String(reason);

  try {
    const position = await prismaClient.testnetPosition.findUnique({
      where: { position_id: String(id) },
      include: { account: true },
    });

    if (!position) {
      return res.status(404).json({ success: false, error: 'Position not found' });
    }
    if (position.status !== 'open') {
      return res.status(400).json({ success: false, error: 'Position is already closed' });
    }

    const { fetchRealTimePrices } = await import('../services/price-fetcher');
    const priceData: any = await fetchRealTimePrices();
    const currentPrice = priceData[position.symbol.toLowerCase()]?.price;

    if (!currentPrice) {
      return res.status(503).json({ success: false, error: 'Unable to fetch current price' });
    }

    const realizedPnl = calculatePnl(position.side, position.entry_price, currentPrice, position.size_qty);
    const isWin = realizedPnl > 0;

    const updatedPosition = await prismaClient.testnetPosition.update({
      where: { position_id: String(id) },
      data: {
        status: 'closed',
        close_price: currentPrice,
        close_time: new Date(),
        close_reason: closeReason,
        current_price: currentPrice,
        realized_pnl: realizedPnl,
        unrealized_pnl: 0,
      },
    });

    await prismaClient.testnetAccount.update({
      where: { id: position.account_id },
      data: {
        current_balance: position.account.current_balance + realizedPnl,
        equity: position.account.current_balance + realizedPnl,
        unrealized_pnl: 0,
        realized_pnl: { increment: realizedPnl },
        total_trades: { increment: 1 },
        winning_trades: { increment: isWin ? 1 : 0 },
        losing_trades: { increment: isWin ? 0 : 1 },
        consecutive_losses: isWin ? 0 : { increment: 1 },
        last_trade_time: new Date(),
        updated_at: new Date(),
      },
    });

    await prismaClient.testnetTradeEvent.create({
      data: {
        position_id: String(id),
        event_type: 'position_closed',
        event_data: JSON.stringify({
          close_price: currentPrice,
          close_reason: closeReason,
          realized_pnl: realizedPnl,
        }),
      },
    });

    return res.json({
      success: true,
      message: 'Position closed successfully',
      data: {
        ...updatedPosition,
        realized_pnl: realizedPnl,
        is_win: isWin,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/pending-orders', async (req: Request, res: Response) => {
  const { status, account_id } = req.query;
  const filters: any = {};
  const accountId = parsePositiveInt(account_id);

  if (status) filters.status = String(Array.isArray(status) ? status[0] : status);
  if (accountId) filters.accountId = accountId;

  try {
    const orders = await getTestnetPendingOrders(filters);
    return res.json({
      success: true,
      data: orders,
      meta: { count: orders.length, filters },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/pending-orders/:id/cancel', async (req: Request, res: Response) => {
  try {
    const { reason = 'manual' } = req.body;
    const cancelReason = Array.isArray(reason) ? reason[0] : String(reason);
    const orders = await getTestnetPendingOrders({ orderId: String(req.params.id) });
    const order = orders[0];

    if (!order) {
      return res.status(404).json({ success: false, error: 'Pending order not found' });
    }
    if (order.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Order is not pending' });
    }

    // Binance-first approach: Cancel Binance order first, then update local DB
    if (process.env.BINANCE_ENABLED === 'true' && order.binance_order_id) {
      try {
        const { initTestnetClient, cancelOrder }: any = await getBinanceHelpers();
        const client = initTestnetClient();
        if (!client) {
          console.error(`[TestnetRoutes] Binance client unavailable for order ${order.order_id}`);
          return res.status(503).json({ 
            success: false, 
            error: 'Binance client unavailable - cannot cancel real order' 
          });
        }

        console.log(`[TestnetRoutes] Cancelling Binance order ${order.binance_order_id} for local order ${order.order_id}`);
        await cancelOrder(client, `${order.symbol}USDT`, Number(order.binance_order_id));
        console.log(`[TestnetRoutes] Binance order ${order.binance_order_id} cancelled successfully`);
      } catch (error: any) {
        console.error(`[TestnetRoutes] Failed to cancel Binance order ${order.binance_order_id}:`, error.message);
        // Phase 9: Do NOT silently fallback - return explicit error
        return res.status(500).json({ 
          success: false, 
          error: `Binance order cancellation failed: ${error.message}`,
          binance_order_id: order.binance_order_id,
        });
      }
    }

    // Only update local DB after successful Binance cancellation (or if BINANCE_ENABLED is false)
    await cancelTestnetPendingOrder(order.order_id, cancelReason);
    console.log(`[TestnetRoutes] Local order ${order.order_id} marked as cancelled`);

    return res.json({
      success: true,
      message: 'Pending order cancelled successfully',
      data: {
        order_id: order.order_id,
        cancel_reason: cancelReason,
        binance_order_id: order.binance_order_id,
      },
    });
  } catch (error: any) {
    console.error('[TestnetRoutes] Error cancelling pending order:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/precision-cooldown/:accountId', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;
  const accountId = parsePositiveInt(req.params.accountId);
  if (!prismaClient) {
    return res.status(503).json({ success: false, error: 'Database not available' });
  }
  if (!accountId) {
    return res.status(400).json({ success: false, error: 'Invalid account id' });
  }

  try {
    const account = await prismaClient.testnetAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      return res.status(404).json({ success: false, error: 'Testnet account not found' });
    }

    const precisionCooldownUntil = account.precision_cooldown_until
      ? new Date(account.precision_cooldown_until)
      : null;
    const isInCooldown = precisionCooldownUntil ? precisionCooldownUntil > new Date() : false;

    return res.json({
      success: true,
      data: {
        account_id: account.id,
        precision_error_count: account.precision_error_count || 0,
        precision_cooldown_until: account.precision_cooldown_until,
        is_in_precision_cooldown: isInCooldown,
        last_precision_error_time: account.last_precision_error_time,
        last_precision_error_code: account.last_precision_error_code,
        last_precision_error_message: account.last_precision_error_message,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/precision-cooldown/:accountId/reset', async (req: Request, res: Response) => {
  const accountId = parsePositiveInt(req.params.accountId);
  if (!accountId) {
    return res.status(400).json({ success: false, error: 'Invalid account id' });
  }

  try {
    await resetPrecisionErrorTracking(accountId);
    return res.json({
      success: true,
      message: 'Precision error tracking reset successfully',
      data: {
        account_id: accountId,
        precision_error_count: 0,
        precision_cooldown_until: null,
        reset_at: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

import 'dotenv/config';

import { prisma } from '../src/lib/prisma';
import { cancelTestnetPendingOrder } from '../src/repositories/testnet.repository';

async function main() {
  const account = await prisma.testnetAccount.findFirst({
    where: {
      symbol: 'BTC',
      method_id: 'kim_nghia',
    },
    orderBy: { updated_at: 'desc' },
  });

  if (!account) {
    throw new Error('Testnet account not found for BTC/kim_nghia');
  }

  const pendingOrders = await prisma.testnetPendingOrder.findMany({
    where: {
      account_id: account.id,
      status: 'pending',
    },
    orderBy: { created_at: 'desc' },
  });

  const cancelledOrderIds: string[] = [];

  let client: unknown = null;
  let cancelOrderFn: ((client: unknown, symbol: string, orderId: string) => Promise<unknown>) | null = null;
  let getBalanceFn: ((client: unknown) => Promise<any>) | null = null;

  try {
    const { initTestnetClient, cancelOrder, getAccountBalance } = await import('../src/services/binanceClient.js');
    client = initTestnetClient();
    cancelOrderFn = cancelOrder;
    getBalanceFn = getAccountBalance;
  } catch (_error) {
    client = null;
  }

  for (const order of pendingOrders) {
    if (client && cancelOrderFn && order.binance_order_id) {
      try {
        await cancelOrderFn(client, `${order.symbol}USDT`, order.binance_order_id);
      } catch (_error) {
        // Continue local cleanup even if Binance-side cancellation fails.
      }
    }

    await cancelTestnetPendingOrder(order.order_id, 'cleanup');
    cancelledOrderIds.push(order.order_id);
  }

  let balanceSummary: {
    walletBalance: number | null;
    equity: number | null;
    unrealizedPnl: number | null;
  } = {
    walletBalance: account.current_balance,
    equity: account.equity,
    unrealizedPnl: account.unrealized_pnl,
  };

  if (client && getBalanceFn) {
    try {
      const balance = await getBalanceFn(client);
      balanceSummary = {
        walletBalance: Number(balance.walletBalance || balance.availableBalance || 0),
        equity: Number(balance.totalWalletBalance || 0),
        unrealizedPnl: Number(balance.totalUnrealizedProfit || 0),
      };

      await prisma.testnetAccount.update({
        where: { id: account.id },
        data: {
          current_balance: balanceSummary.walletBalance ?? account.current_balance,
          equity: balanceSummary.equity ?? account.equity,
          unrealized_pnl: balanceSummary.unrealizedPnl ?? account.unrealized_pnl,
          updated_at: new Date(),
        },
      });
    } catch (_error) {
      // Keep cleanup successful even if balance refresh fails.
    }
  }

  const phantomStatuses = [
    'reconciliation_failed_not_on_binance',
    'failed_no_binance_id',
  ];
  const phantomPositions = await prisma.testnetPosition.findMany({
    where: {
      account_id: account.id,
      status: { in: phantomStatuses },
    },
  });

  const removedPositionIds: string[] = [];
  for (const pos of phantomPositions) {
    await prisma.testnetPosition.delete({ where: { position_id: pos.position_id } });
    removedPositionIds.push(pos.position_id);
  }

  const openPositionsCount = await prisma.testnetPosition.count({
    where: { account_id: account.id, status: 'open' },
  });

  await prisma.testnetAccountSnapshot.create({
    data: {
      account_id: account.id,
      balance: balanceSummary.walletBalance ?? account.current_balance,
      equity: balanceSummary.equity ?? account.equity,
      unrealized_pnl: balanceSummary.unrealizedPnl ?? account.unrealized_pnl,
      realized_pnl: account.realized_pnl,
      open_positions_count: openPositionsCount,
    },
  });

  console.log(
    '[TestnetCleanup] Cleanup completed:',
    JSON.stringify({
      cancelledOrderIds,
      removedPhantomPositions: removedPositionIds,
      walletBalance: balanceSummary.walletBalance,
      equity: balanceSummary.equity,
      unrealizedPnl: balanceSummary.unrealizedPnl,
    })
  );
}

main()
  .catch((error) => {
    console.error('[TestnetCleanup] Cleanup failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

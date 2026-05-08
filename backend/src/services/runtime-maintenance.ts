import { prisma } from '../lib/prisma';

export async function createTradingSnapshots(): Promise<void> {
  const accounts = await prisma.account.findMany({
    select: { id: true, current_balance: true, equity: true, unrealized_pnl: true },
  });

  for (const account of accounts) {
    const openPositions = await prisma.position.count({
      where: { account_id: account.id, status: 'open' },
    });

    await prisma.accountSnapshot.create({
      data: {
        account_id: account.id,
        balance: account.current_balance,
        equity: account.equity,
        unrealized_pnl: account.unrealized_pnl,
        open_positions: openPositions,
      },
    });
  }

  const testnetAccounts = await prisma.testnetAccount.findMany({
    select: { id: true, current_balance: true, equity: true, unrealized_pnl: true, realized_pnl: true },
  });

  for (const account of testnetAccounts) {
    const openPositionsCount = await prisma.testnetPosition.count({
      where: { account_id: account.id, status: 'open' },
    });

    await prisma.testnetAccountSnapshot.create({
      data: {
        account_id: account.id,
        balance: account.current_balance,
        equity: account.equity,
        unrealized_pnl: account.unrealized_pnl,
        realized_pnl: account.realized_pnl,
        open_positions_count: openPositionsCount,
      },
    });
  }
}

export async function runDataRetention(
  retentionDaysPriceHistory: number,
  retentionDaysOhlcv: number
): Promise<{ priceHistoryDeleted: number; ohlcvDeleted: number }> {
  const now = Date.now();
  const priceHistoryCutoff = new Date(now - retentionDaysPriceHistory * 24 * 60 * 60 * 1000);
  const ohlcvCutoff = new Date(now - retentionDaysOhlcv * 24 * 60 * 60 * 1000);

  const [priceHistoryResult, ohlcvResult] = await Promise.all([
    prisma.priceHistory.deleteMany({
      where: { timestamp: { lt: priceHistoryCutoff } },
    }),
    prisma.ohlcvCandle.deleteMany({
      where: { timestamp: { lt: ohlcvCutoff } },
    }),
  ]);

  return {
    priceHistoryDeleted: priceHistoryResult.count,
    ohlcvDeleted: ohlcvResult.count,
  };
}

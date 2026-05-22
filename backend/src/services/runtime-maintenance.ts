import { prisma } from '../lib/prisma';

const SNAPSHOT_MIN_INTERVAL_MS = parseInt(
  process.env.SNAPSHOT_MIN_INTERVAL_MS || '900000',
  10
);

const lastSnapshotAt = new Map<number, number>();

function materiallyChanged(
  prev: {
    balance: number;
    equity: number;
    open_positions_count: number;
  },
  next: {
    balance: number;
    equity: number;
    open_positions_count: number;
  }
): boolean {
  if (prev.open_positions_count !== next.open_positions_count) return true;
  const ref = Math.max(Math.abs(prev.equity), Math.abs(next.equity), 1e-9);
  if (Math.abs(next.equity - prev.equity) / ref >= 0.0005) return true;
  if (Math.abs(next.balance - prev.balance) / Math.max(Math.abs(prev.balance), 1e-9) >= 0.0005) {
    return true;
  }
  return false;
}

export async function createTradingSnapshots(): Promise<void> {
  const testnetAccounts = await prisma.testnetAccount.findMany({
    select: { id: true, current_balance: true, equity: true, unrealized_pnl: true, realized_pnl: true },
  });

  const now = Date.now();

  for (const account of testnetAccounts) {
    const openPositionsCount = await prisma.testnetPosition.count({
      where: { account_id: account.id, status: 'open' },
    });

    const balance = account.current_balance ?? 0;
    const equity = account.equity ?? 0;

    const lastAt = lastSnapshotAt.get(account.id) ?? 0;
    if (now - lastAt < SNAPSHOT_MIN_INTERVAL_MS) {
      const latest = await prisma.testnetAccountSnapshot.findFirst({
        where: { account_id: account.id },
        orderBy: { timestamp: 'desc' },
        select: {
          balance: true,
          equity: true,
          open_positions_count: true,
        },
      });
      if (
        latest &&
        !materiallyChanged(
          {
            balance: latest.balance,
            equity: latest.equity,
            open_positions_count: latest.open_positions_count,
          },
          { balance, equity, open_positions_count: openPositionsCount }
        )
      ) {
        continue;
      }
    }

    await prisma.testnetAccountSnapshot.create({
      data: {
        account_id: account.id,
        balance,
        equity,
        unrealized_pnl: account.unrealized_pnl,
        realized_pnl: account.realized_pnl,
        open_positions_count: openPositionsCount,
      },
    });
    lastSnapshotAt.set(account.id, now);
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

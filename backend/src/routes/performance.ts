import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import {
  calculateClosedTradeMetrics,
  getFullHistoryWalletMetrics,
} from '../services/account-performance.service';
import {
  getAccountCircuitStatus,
  type CircuitStatus,
} from '../services/account-circuit.service';

const router = Router();

// Extend Express Request to include prisma
declare global {
  namespace Express {
    interface Request {
      prisma?: typeof prisma;
    }
  }
}

function toPositiveInt(value: any, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function resolveAccount(
  prismaClient: typeof prisma,
  symbol: string,
  method?: string
) {
  if (!symbol) {
    return null;
  }

  const normalizedSymbol = String(symbol).toUpperCase();
  const methodId = method ? String(method) : 'kim_nghia';
  return prismaClient.testnetAccount.findUnique({
    where: {
      symbol_method_id: {
        symbol: normalizedSymbol,
        method_id: methodId,
      },
    },
  });
}

type CircuitLoader = (accountId: number) => Promise<CircuitStatus>;

export async function buildPerformanceMetrics(
  prismaClient: typeof prisma,
  account: any,
  loadCircuit: CircuitLoader = getAccountCircuitStatus
) {
  const closedPositions = await prismaClient.testnetPosition.findMany({
    where: {
      account_id: account.id,
      close_time: { not: null },
    },
    orderBy: { close_time: 'asc' },
  });
  const [trades, fullHistory, circuit] = await Promise.all([
    Promise.resolve(calculateClosedTradeMetrics(closedPositions)),
    getFullHistoryWalletMetrics(prismaClient, account),
    loadCircuit(account.id),
  ]);

  return {
    symbol: account.symbol,
    method_id: account.method_id,
    starting_balance: fullHistory.baselineBalance,
    current_balance: fullHistory.currentBalance,
    current_equity: fullHistory.currentEquity,
    total_return_percent: fullHistory.walletReturnPercent,
    total_trades: trades.totalTrades,
    winning_trades: trades.wins,
    losing_trades: trades.losses,
    breakeven_trades: trades.breakeven,
    win_rate: trades.winRate,
    win_rate_all_closed: trades.winRateAllClosed,
    gross_profit: trades.grossProfit,
    gross_loss: trades.grossLoss,
    avg_win: trades.avgWin,
    avg_loss: trades.avgLoss,
    profit_factor: trades.profitFactor,
    max_drawdown: fullHistory.maxDrawdownPercent,
    current_drawdown: fullHistory.currentDrawdownPercent,
    avg_r_multiple: trades.avgRMultiple,
    realized_pnl: fullHistory.walletPnl,
    wallet_pnl: fullHistory.walletPnl,
    position_pnl: trades.positionPnl,
    stored_fees: trades.storedFees,
    pnl_gap_vs_positions: fullHistory.walletPnl - trades.positionPnl,
    pnl_source: 'testnet_account_wallet',
    full_history: {
      scope: fullHistory.scope,
      baseline_balance: fullHistory.baselineBalance,
      current_balance: fullHistory.currentBalance,
      current_equity: fullHistory.currentEquity,
      wallet_pnl: fullHistory.walletPnl,
      wallet_return_percent: fullHistory.walletReturnPercent,
      peak_equity: fullHistory.peakEquity,
      peak_equity_at: fullHistory.peakEquityAt,
      current_drawdown_percent: fullHistory.currentDrawdownPercent,
      max_drawdown_percent: fullHistory.maxDrawdownPercent,
      max_drawdown_at: fullHistory.maxDrawdownAt,
      first_snapshot_at: fullHistory.firstSnapshotAt,
      last_snapshot_at: fullHistory.lastSnapshotAt,
      snapshot_count: fullHistory.snapshotCount,
    },
    strategy_epoch: {
      scope: circuit.scope,
      starts_at: circuit.epochStart,
      peak_equity: circuit.peakEquity,
      peak_equity_source: circuit.peakEquitySource,
      drawdown_percent: circuit.drawdownPercent,
      expectancy_since: circuit.expectancySince,
      expectancy: circuit.expectancy,
      trading_allowed: circuit.allowed,
      circuit_reason: circuit.reason,
    },
  };
}

router.get('/', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;
  if (!prismaClient) {
    return res.status(503).json({
      success: false,
      error: 'Database not available',
    });
  }

  const { symbol, method } = req.query;
  if (!symbol) {
    return res.status(400).json({
      success: false,
      error: 'Symbol parameter required',
    });
  }

  try {
    const account = await resolveAccount(prismaClient, String(symbol), method as string);
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found',
      });
    }

    const performance = await buildPerformanceMetrics(prismaClient, account);
    return res.json({
      success: true,
      data: performance,
      meta: { symbol: account.symbol, account_id: account.id, method: method || null },
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.get('/equity-curve', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;
  if (!prismaClient) {
    return res.status(503).json({
      success: false,
      error: 'Database not available',
    });
  }

  const { symbol, method, limit, hours } = req.query;
  if (!symbol) {
    return res.status(400).json({
      success: false,
      error: 'Symbol parameter required',
    });
  }

  try {
    const account = await resolveAccount(prismaClient, String(symbol), method as string);
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found',
      });
    }

    const hoursNum = toPositiveInt(hours, 0);
    const take = toPositiveInt(limit, hoursNum || 100);
    const snapshotsDescending = await prismaClient.testnetAccountSnapshot.findMany({
      where: {
        account_id: account.id,
        ...(hoursNum > 0
          ? { timestamp: { gte: new Date(Date.now() - hoursNum * 3_600_000) } }
          : {}),
      },
      orderBy: { timestamp: 'desc' },
      take,
    });
    const snapshots = snapshotsDescending.reverse();

    return res.json({
      success: true,
      data: snapshots,
      meta: {
        symbol: account.symbol,
        count: snapshots.length,
        limit: take,
        hours: hoursNum || null,
        method: account.method_id,
        source: 'testnet_account_snapshots',
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.get('/trades', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;
  if (!prismaClient) {
    return res.status(503).json({
      success: false,
      error: 'Database not available',
    });
  }

  const { symbol, limit, page, outcome, method } = req.query;
  const limitNum = toPositiveInt(limit, 10);
  const pageNum = toPositiveInt(page, 1);
  const skip = (pageNum - 1) * limitNum;
  const where: any = {
    ...(symbol ? { symbol: String(symbol).toUpperCase() } : {}),
    close_time: { not: null },
    ...(method ? { account: { method_id: String(method) } } : {}),
    ...(outcome === 'win'
      ? { realized_pnl: { gt: 0 } }
      : outcome === 'loss'
        ? { realized_pnl: { lt: 0 } }
        : {}),
  };

  try {
    const [total, positions] = await Promise.all([
      prismaClient.testnetPosition.count({ where }),
      prismaClient.testnetPosition.findMany({
        where,
        orderBy: { close_time: 'desc' },
        take: limitNum,
        skip,
      }),
    ]);

    return res.json({
      success: true,
      data: positions,
      meta: {
        total,
        page: pageNum,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
        limit: limitNum,
        symbol: symbol || null,
        outcome: outcome || 'all',
        method: method || null,
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.get('/accuracy-timeframe', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;
  if (!prismaClient) {
    return res.status(503).json({ success: false, error: 'Database not available' });
  }

  const { symbol, method } = req.query;
  if (!symbol) {
    return res.status(400).json({ success: false, error: 'Symbol parameter required' });
  }

  try {
    const predictions = await prismaClient.prediction.findMany({
      where: {
        coin: String(symbol).toUpperCase(),
        actual_price: { not: null },
        ...(method ? { method_id: String(method) } : {}),
      },
      select: {
        timeframe: true,
        is_correct: true,
      },
    });

    const grouped: Record<string, { total: number; correct: number; accuracy: number }> = {};
    predictions.reduce((acc, prediction) => {
      if (!acc[prediction.timeframe]) {
        acc[prediction.timeframe] = { total: 0, correct: 0, accuracy: 0 };
      }
      acc[prediction.timeframe].total += 1;
      if (prediction.is_correct) {
        acc[prediction.timeframe].correct += 1;
      }
      return acc;
    }, grouped);

    for (const timeframe of Object.keys(grouped)) {
      const group = grouped[timeframe];
      group.accuracy = group.total ? group.correct / group.total : 0;
    }

    return res.json({
      success: true,
      data: grouped,
      meta: { symbol: String(symbol).toUpperCase(), method: method || null },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/accuracy-bias', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;
  if (!prismaClient) {
    return res.status(503).json({ success: false, error: 'Database not available' });
  }

  const { symbol, method } = req.query;
  if (!symbol) {
    return res.status(400).json({ success: false, error: 'Symbol parameter required' });
  }

  try {
    const predictions = await prismaClient.prediction.findMany({
      where: {
        coin: String(symbol).toUpperCase(),
        actual_price: { not: null },
        ...(method ? { method_id: String(method) } : {}),
      },
      include: {
        analysis: {
          select: { bias: true },
        },
      },
    });

    const grouped: Record<string, { total: number; correct: number; accuracy: number }> = {};
    predictions.reduce((acc, prediction) => {
      const bias = prediction.analysis?.bias || 'unknown';
      if (!acc[bias]) {
        acc[bias] = { total: 0, correct: 0, accuracy: 0 };
      }
      acc[bias].total += 1;
      if (prediction.is_correct) {
        acc[bias].correct += 1;
      }
      return acc;
    }, grouped);

    for (const bias of Object.keys(grouped)) {
      const group = grouped[bias];
      group.accuracy = group.total ? group.correct / group.total : 0;
    }

    return res.json({
      success: true,
      data: grouped,
      meta: { symbol: String(symbol).toUpperCase(), method: method || null },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/hold-time', async (req: Request, res: Response) => {
  const prismaClient = req.prisma || prisma;
  if (!prismaClient) {
    return res.status(503).json({ success: false, error: 'Database not available' });
  }

  const { symbol, method } = req.query;
  if (!symbol) {
    return res.status(400).json({ success: false, error: 'Symbol parameter required' });
  }

  try {
    const positions = await prismaClient.testnetPosition.findMany({
      where: {
        symbol: String(symbol).toUpperCase(),
        close_time: { not: null },
        ...(method ? { account: { method_id: String(method) } } : {}),
      },
      select: {
        entry_time: true,
        close_time: true,
      },
    });

    const durations = positions
      .filter((position: any) => position.close_time)
      .map((position: any) => position.close_time.getTime() - position.entry_time.getTime())
      .filter((duration: number) => duration >= 0);

    const averageMs = durations.length
      ? durations.reduce((sum: number, duration: number) => sum + duration, 0) / durations.length
      : 0;

    return res.json({
      success: true,
      data: {
        average_hold_ms: averageMs,
        average_hold_minutes: averageMs / (1000 * 60),
        average_hold_hours: averageMs / (1000 * 60 * 60),
        total_trades: durations.length,
      },
      meta: { symbol: String(symbol).toUpperCase(), method: method || null },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

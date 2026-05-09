import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';

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

async function resolveAccount(prismaClient: typeof prisma, symbol: string, method?: string) {
  if (!symbol) {
    return null;
  }

  const normalizedSymbol = String(symbol).toUpperCase();
  if (method) {
    return prismaClient.account.findUnique({
      where: {
        symbol_method_id: {
          symbol: normalizedSymbol,
          method_id: String(method),
        },
      },
    });
  }

  return prismaClient.account.findFirst({
    where: { symbol: normalizedSymbol },
    orderBy: { created_at: 'desc' },
  });
}

async function buildPerformanceMetrics(prismaClient: typeof prisma, account: any) {
  const closedPositions = await prismaClient.position.findMany({
    where: {
      account_id: account.id,
      close_time: { not: null },
    },
    orderBy: { close_time: 'asc' },
  });

  const winningTrades = closedPositions.filter((position: any) => (position.realized_pnl || 0) > 0).length;
  const losingTrades = closedPositions.filter((position: any) => (position.realized_pnl || 0) < 0).length;
  const realizedPnl = closedPositions.reduce((sum: number, position: any) => sum + (position.realized_pnl || 0), 0);
  const grossProfit = closedPositions.reduce(
    (sum: number, position: any) => sum + Math.max(position.realized_pnl || 0, 0),
    0
  );
  const grossLoss = closedPositions.reduce(
    (sum: number, position: any) => sum + Math.min(position.realized_pnl || 0, 0),
    0
  );
  const avgRMultiple = closedPositions.length
    ? closedPositions.reduce((sum: number, position: any) => sum + (position.r_multiple || 0), 0) / closedPositions.length
    : 0;
  const winRate = closedPositions.length ? (winningTrades / closedPositions.length) * 100 : 0;
  const profitFactor = grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? Infinity : 0;
  const totalReturnPercent = account.starting_balance
    ? ((account.equity - account.starting_balance) / account.starting_balance) * 100
    : 0;

  return {
    symbol: account.symbol,
    starting_balance: account.starting_balance,
    current_equity: account.equity,
    total_return_percent: totalReturnPercent,
    total_trades: closedPositions.length,
    winning_trades: winningTrades,
    losing_trades: losingTrades,
    win_rate: winRate,
    profit_factor: Number.isFinite(profitFactor) ? profitFactor : null,
    max_drawdown: account.max_drawdown || 0,
    avg_r_multiple: avgRMultiple,
    realized_pnl: realizedPnl,
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

    const take = toPositiveInt(limit || hours, 100);
    const snapshots = await prismaClient.accountSnapshot.findMany({
      where: { account_id: account.id },
      orderBy: { timestamp: 'asc' },
      take,
    });

    return res.json({
      success: true,
      data: snapshots,
      meta: { symbol: account.symbol, count: snapshots.length, limit: take, method: method || null },
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
      prismaClient.position.count({ where }),
      prismaClient.position.findMany({
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
    const positions = await prismaClient.position.findMany({
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

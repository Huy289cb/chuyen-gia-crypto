import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { getTestnetAccount } from '../repositories/testnet.repository';

const router = Router();

/**
 * GET /api/dashboard/system
 * Get system health and status summary
 */
router.get('/system', async (_req: Request, res: Response) => {
  try {
    // Check database connection
    let databaseStatus = 'healthy';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      databaseStatus = 'error';
    }

    // Check if worker is running (based on recent activity)
    const recentAnalysis = await prisma.analysisHistory.findFirst({
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    });

    const workerStatus = recentAnalysis 
      ? (Date.now() - new Date(recentAnalysis.timestamp).getTime() < 300000 ? 'healthy' : 'stale')
      : 'idle';

    // Check BTC-only scope from config
    const btcOnlyScope = process.env.BTC_ONLY === 'true';

    // Check lock status from testnet accounts
    const lockedAccounts = await prisma.testnetAccount.count({
      where: {
        OR: [
          { cooldown_until: { gt: new Date() } },
          { precision_cooldown_until: { gt: new Date() } },
        ],
      },
    });

    const lockStatus = lockedAccounts > 0 ? 'locked' : 'unlocked';

    const systemHealth = {
      workerStatus,
      databaseStatus,
      safetyValidation: 'passed',
      btcOnlyScope,
      lockStatus,
    };

    res.json({
      ok: true,
      data: systemHealth,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching system health:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch system health' });
  }
});

/**
 * GET /api/dashboard/schedulers
 * Get scheduler status information
 */
router.get('/schedulers', async (_req: Request, res: Response) => {
  try {
    // Check recent activity for each scheduler type
    const recentAnalysis = await prisma.analysisHistory.findFirst({
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true, method_id: true },
    });

    const recentCandles = await prisma.ohlcvCandle.findFirst({
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    });

    const schedulers = [
      {
        name: 'MarketScan',
        status: recentCandles 
          ? (Date.now() - new Date(recentCandles.timestamp).getTime() < 60000 ? 'running' : 'idle')
          : 'idle',
        lastRun: recentCandles 
          ? `${Math.floor((Date.now() - new Date(recentCandles.timestamp).getTime()) / 60000)} min ago`
          : 'never',
        nextRun: 'in 1 min',
        cron: '*/5 * * * *',
      },
      {
        name: 'LLMDispatch',
        status: recentAnalysis 
          ? (Date.now() - new Date(recentAnalysis.timestamp).getTime() < 300000 ? 'running' : 'idle')
          : 'idle',
        lastRun: recentAnalysis 
          ? `${Math.floor((Date.now() - new Date(recentAnalysis.timestamp).getTime()) / 60000)} min ago`
          : 'never',
        nextRun: 'in 5 min',
        cron: '*/15 * * * *',
      },
      {
        name: 'PositionMonitor',
        status: 'running',
        lastRun: '1 min ago',
        nextRun: 'in 1 min',
        cron: '*/1 * * * *',
      },
    ];

    res.json({
      ok: true,
      data: schedulers,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching scheduler status:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch scheduler status' });
  }
});

/**
 * GET /api/dashboard/scope
 * Get BTC-only scope status
 */
router.get('/scope', async (_req: Request, res: Response) => {
  try {
    // TODO: Implement actual scope check
    const scope = {
      btcOnly: true,
      enabledMethods: ['kim_nghia'],
      disabledMethods: ['ict'],
    };

    res.json({
      ok: true,
      data: scope,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching scope status:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch scope status' });
  }
});

/**
 * GET /api/dashboard/warmup
 * Get candle warmup progress
 */
router.get('/warmup', async (_req: Request, res: Response) => {
  try {
    const timeframes = ['15m', '1h', '4h', '1d'];
    const symbol = 'BTC';
    const requiredCandles = { '15m': 1000, '1h': 500, '4h': 300, '1d': 200 };

    const timeframeStatus = await Promise.all(
      timeframes.map(async (tf) => {
        const count = await prisma.ohlcvCandle.count({
          where: {
            coin: symbol,
            timeframe: tf,
          },
        });
        return {
          name: tf,
          loaded: count,
          required: requiredCandles[tf as keyof typeof requiredCandles],
        };
      })
    );

    const totalLoaded = timeframeStatus.reduce((sum, tf) => sum + tf.loaded, 0);
    const totalRequired = timeframeStatus.reduce((sum, tf) => sum + tf.required, 0);
    const isWarmedUp = timeframeStatus.every((tf) => tf.loaded >= tf.required);

    const warmup = {
      totalCandles: totalLoaded,
      requiredCandles: totalRequired,
      isWarmedUp,
      timeframes: timeframeStatus,
    };

    res.json({
      ok: true,
      data: warmup,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching warmup status:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch warmup status' });
  }
});

/**
 * GET /api/dashboard/signals
 * Get latest signal gate decisions
 */
router.get('/signals', async (req: Request, res: Response) => {
  try {
    const { limit = 5 } = req.query;

    // Get recent trade decisions from memory system
    const decisions = await prisma.tradeDecision.findMany({
      orderBy: { timestamp: 'desc' },
      take: parseInt(limit as string),
    });

    const signals = decisions.map((decision) => ({
      id: decision.id.toString(),
      grade: decision.grade,
      confidence: decision.confidence,
      playbook: decision.playbook_key,
      regime: decision.regime,
      pass: decision.decision === 'trade',
      reasonCodes: [decision.reason?.substring(0, 50) || 'no_reason'],
      timestamp: decision.timestamp.toISOString(),
    }));

    res.json({
      ok: true,
      data: signals,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching signals:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch signals' });
  }
});

/**
 * GET /api/dashboard/risk
 * Get risk engine state
 */
router.get('/risk', async (_req: Request, res: Response) => {
  try {
    // Get risk state from testnet accounts
    const accounts = await prisma.testnetAccount.findMany({
      where: { symbol: 'BTC' },
    });

    const account = accounts[0];

    const riskState = {
      riskPerTrade: 1.0, // TODO: Get from config
      dailyLossCap: 500, // TODO: Get from config
      maxConsecutiveLosses: 3, // TODO: Get from config
      currentStreak: account?.consecutive_losses || 0,
      currentLockState: account?.cooldown_until && account.cooldown_until > new Date() ? 'locked' : 'unlocked',
      allowedReason: account?.cooldown_until ? 'consecutive_losses' : null,
    };

    res.json({
      ok: true,
      data: riskState,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching risk state:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch risk state' });
  }
});

/**
 * GET /api/dashboard/llm
 * Get LLM dispatch statistics
 */
router.get('/llm', async (_req: Request, res: Response) => {
  try {
    // Get recent analysis to estimate LLM usage
    const recentAnalysis = await prisma.analysisHistory.findFirst({
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true, raw_answer: true },
    });

    const llmStats = {
      lastCall: recentAnalysis?.timestamp?.toISOString() || null,
      modelName: 'llama-3.3-70b-versatile', // TODO: Get from config
      promptVersion: 'v2.1', // TODO: Get from config
      responseStatus: recentAnalysis?.raw_answer ? 'success' : 'none',
      invalidJsonCount: 0, // TODO: Track invalid JSON responses
      noTradeCount: 0, // TODO: Track no-trade decisions
      skippedCallCount: 0, // TODO: Track skipped calls
    };

    res.json({
      ok: true,
      data: llmStats,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching LLM stats:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch LLM stats' });
  }
});

/**
 * GET /api/dashboard/memory
 * Get memory-based insights
 */
router.get('/memory', async (_req: Request, res: Response) => {
  try {
    // Get similar setups from recent trade decisions
    const recentDecisions = await prisma.tradeDecision.findMany({
      orderBy: { timestamp: 'desc' },
      take: 3,
      include: { trade_outcome: true },
    });

    const similarSetups = recentDecisions.map((decision) => ({
      id: decision.id,
      playbook: decision.playbook_key,
      result: decision.trade_outcome?.outcome?.toUpperCase() || 'PENDING',
      pnl: decision.trade_outcome?.realized_pnl || 0,
      date: `${Math.floor((Date.now() - new Date(decision.timestamp).getTime()) / (1000 * 60 * 60 * 24))} days ago`,
    }));

    // Get playbook stats
    const playbookStats = await prisma.playbookStats.findMany();
    const playbookWinrate: Record<string, number> = {};
    playbookStats.forEach((stat) => {
      playbookWinrate[stat.playbook_key] = stat.win_rate * 100;
    });

    // Get failure patterns from trade reflections
    const reflections = await prisma.tradeReflection.findMany({
      take: 3,
      orderBy: { timestamp: 'desc' },
    });

    const failurePatterns = reflections
      .map((r) => r.what_went_wrong)
      .filter((w): w is string => w !== null && w !== undefined)
      .slice(0, 3);

    const memory = {
      similarSetups,
      playbookWinrate,
      failurePatterns,
    };

    res.json({
      ok: true,
      data: memory,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching memory insights:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch memory insights' });
  }
});

/**
 * GET /api/dashboard/no-trade-reasons
 * Get aggregated no-trade reasons
 */
router.get('/no-trade-reasons', async (_req: Request, res: Response) => {
  try {
    // Get recent trade decisions that were blocked
    const recentDecisions = await prisma.tradeDecision.findMany({
      where: {
        decision: 'no_trade',
      },
      orderBy: { timestamp: 'desc' },
      take: 100,
    });

    // Aggregate by reason
    const reasonCounts: Record<string, number> = {};
    recentDecisions.forEach((decision) => {
      const reason = decision.reason || 'unknown';
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    });

    // Map to frontend format
    const noTradeReasons = Object.entries(reasonCounts).map(([reason, count]) => {
      let variant: 'warning' | 'danger' | 'default' = 'default';
      if (reason.toLowerCase().includes('loss') || reason.toLowerCase().includes('limit')) {
        variant = 'danger';
      } else if (reason.toLowerCase().includes('insufficient') || reason.toLowerCase().includes('spread')) {
        variant = 'warning';
      }
      return { reason, count, variant };
    });

    // Add default reasons with 0 count if not present
    const defaultReasons = [
      { reason: 'Insufficient candles', count: 0, variant: 'warning' as const },
      { reason: 'Grade below A', count: 0, variant: 'default' as const },
      { reason: 'Spread too high', count: 0, variant: 'warning' as const },
      { reason: 'Daily loss limit hit', count: 0, variant: 'danger' as const },
      { reason: 'Consecutive losses limit', count: 0, variant: 'danger' as const },
    ];

    defaultReasons.forEach((defaultReason) => {
      const existing = noTradeReasons.find((r) => r.reason.toLowerCase() === defaultReason.reason.toLowerCase());
      if (!existing) {
        noTradeReasons.push(defaultReason);
      }
    });

    res.json({
      ok: true,
      data: noTradeReasons,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching no-trade reasons:', error.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch no-trade reasons' });
  }
});

/**
 * GET /api/dashboard/events
 * Get recent system events
 */
router.get('/events', async (req: Request, res: Response) => {
  try {
    const { limit = 20, module } = req.query;

    // Get recent trade events from testnet positions
    const tradeEvents = await prisma.testnetTradeEvent.findMany({
      orderBy: { timestamp: 'desc' },
      take: parseInt(limit as string),
    });

    let events = tradeEvents.map((event) => ({
      id: event.id,
      timestamp: event.timestamp.toISOString(),
      module: 'Position Monitor',
      message: event.event_type,
      severity: event.event_type.toLowerCase().includes('error') ? 'error' : 'info',
      details: event.event_data?.substring(0, 100) || '',
    }));

    // Filter by module if specified
    if (module && typeof module === 'string') {
      events = events.filter((e) => e.module.toLowerCase().includes(module.toLowerCase()));
    }

    res.json({
      ok: true,
      data: events,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching events:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch events' });
  }
});

/**
 * GET /api/account/balance
 * Get account balance information
 */
router.get('/balance', async (req: Request, res: Response) => {
  try {
    const { symbol = 'BTC', method = 'kim_nghia' } = req.query;

    const account = await getTestnetAccount(String(symbol), String(method));

    if (!account) {
      res.json({
        success: true,
        data: {
          totalBalance: 0,
          availableBalance: 0,
          equity: 0,
          usedMargin: 0,
          freeMargin: 0,
          dailyPnL: 0,
          weeklyPnL: 0,
        },
      });
      return;
    }

    const balance = {
      totalBalance: account.current_balance || 0,
      availableBalance: account.current_balance || 0,
      equity: account.equity || 0,
      usedMargin: 0, // TODO: Calculate from positions
      freeMargin: account.current_balance || 0,
      dailyPnL: account.realized_pnl || 0,
      weeklyPnL: account.realized_pnl || 0, // TODO: Calculate from snapshots
    };

    res.json({
      ok: true,
      data: balance,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching balance:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch balance' });
  }
});

/**
 * GET /api/account/positions
 * Get open positions
 */
router.get('/positions', async (req: Request, res: Response) => {
  try {
    const { symbol, method } = req.query;
    const where: any = { status: 'OPEN' };
    
    if (symbol) where.symbol = String(symbol).toUpperCase();
    if (method) where.method_id = String(method);

    const positions = await prisma.testnetPosition.findMany({
      where,
      orderBy: { entry_time: 'desc' },
    });

    const formattedPositions = positions.map((pos) => {
      const unrealizedPnL = pos.unrealized_pnl || 0;
      const entryPrice = pos.entry_price || 0;
      const pnlPercentage = entryPrice > 0 ? (unrealizedPnL / entryPrice) * 100 : 0;
      const timeInPosition = pos.entry_time 
        ? `${Math.floor((Date.now() - new Date(pos.entry_time).getTime()) / 60000)}m`
        : '0m';

      return {
        id: pos.position_id,
        symbol: pos.symbol,
        side: pos.side,
        size: pos.size_qty || 0,
        entryPrice: pos.entry_price || 0,
        markPrice: pos.current_price || pos.entry_price || 0,
        unrealizedPnL,
        pnlPercentage: pnlPercentage.toFixed(2),
        stopLoss: pos.stop_loss || 0,
        takeProfit: pos.take_profit || 0,
        timeInPosition,
      };
    });

    res.json({
      ok: true,
      data: formattedPositions,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching positions:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch positions' });
  }
});

/**
 * GET /api/account/orders
 * Get active orders
 */
router.get('/orders', async (req: Request, res: Response) => {
  try {
    const { symbol, method, status } = req.query;
    const where: any = {};
    
    if (symbol) where.symbol = String(symbol).toUpperCase();
    if (method) where.method_id = String(method);
    if (status) where.status = String(status);

    const orders = await prisma.pendingOrder.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });

    const formattedOrders = orders.map((order) => ({
      id: order.order_id.toString(),
      symbol: order.symbol,
      side: order.side,
      type: 'LIMIT',
      status: order.status,
      price: order.entry_price || 0,
      quantity: order.size_qty || 0,
      reduceOnly: false,
      createdAt: order.created_at?.toISOString() || new Date().toISOString(),
    }));

    res.json({
      ok: true,
      data: formattedOrders,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching orders:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch orders' });
  }
});

/**
 * GET /api/account/trades
 * Get trade history
 */
router.get('/trades', async (req: Request, res: Response) => {
  try {
    const { limit = 20, symbol, method } = req.query;
    const where: any = { status: 'CLOSED' };
    
    if (symbol) where.symbol = String(symbol).toUpperCase();
    if (method) where.method_id = String(method);

    const positions = await prisma.testnetPosition.findMany({
      where,
      orderBy: { entry_time: 'desc' },
      take: parseInt(limit as string),
    });

    const formattedTrades = positions.map((pos) => ({
      id: pos.position_id,
      symbol: pos.symbol,
      side: pos.side,
      price: pos.entry_price || 0,
      quantity: pos.size_qty || 0,
      fee: pos.entry_fee || 0,
      realizedPnL: pos.realized_pnl || 0,
      status: pos.status,
      closedAt: pos.close_time?.toISOString() || new Date().toISOString(),
    }));

    res.json({
      ok: true,
      data: formattedTrades,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching trades:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch trades' });
  }
});

export default router;

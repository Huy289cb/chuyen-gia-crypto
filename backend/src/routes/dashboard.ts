import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { getTestnetAccount } from '../repositories/testnet.repository';
import { validateSafetyRequirements } from '../config/app';
import { getRiskPolicy } from '../config/risk-policy';
import { METHODS } from '../config/methods';

const router = Router();

function formatRelativeAgo(ts: Date | null): string {
  if (!ts) return 'never';
  const ms = Date.now() - ts.getTime();
  if (ms < 45_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 120) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function inferSchedulerStatus(last: Date | null, staleAfterMs: number): string {
  if (!last) return 'idle';
  return Date.now() - last.getTime() < staleAfterMs ? 'running' : 'idle';
}

/** Rough next-fire hint for star-slash-N minute step crons (matches worker v3). */
function estimateNextCronHint(last: Date | null, cronExpr: string): string {
  if (!last) return '—';
  const part = cronExpr.trim().split(/\s+/)[0] || '';
  const m = part.match(/^\*\/(\d+)$/);
  if (!m) return '—';
  const stepMs = parseInt(m[1], 10) * 60_000;
  const elapsed = Date.now() - last.getTime();
  const until = Math.max(0, stepMs - (elapsed % stepMs || stepMs));
  const untilMin = Math.ceil(until / 60_000);
  if (untilMin <= 1) return 'within 1 min';
  return `~${untilMin} min`;
}

function toReasonCodes(reason: string | null | undefined): string[] {
  if (!reason || !reason.trim()) return [];
  const byNl = reason
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byNl.length > 1) return byNl;
  const bySemi = reason
    .split(/;\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (bySemi.length > 1) return bySemi;
  return [reason.trim()];
}

function btcOnlyFromConfig(): boolean {
  if (process.env.BTC_ONLY === 'true') return true;
  const enabled = Object.values(METHODS).filter((m) => m.enabled);
  if (enabled.length === 0) return false;
  return !enabled.some((m) => m.autoEntry?.enabledSymbols?.includes('ETH'));
}

function isSignalGateOnlyReason(reason: string): boolean {
  const r = reason || '';
  return r.startsWith('Signal gate:') || r.startsWith('Signal gate blocked:');
}

/**
 * GET /api/dashboard/system
 * Get system health and status summary
 */
router.get('/system', async (_req: Request, res: Response) => {
  try {
    let databaseStatus = 'healthy';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      databaseStatus = 'error';
    }

    const [lastCandle, lastDecision, lastAccountTouch] = await Promise.all([
      prisma.ohlcvCandle.findFirst({
        where: { coin: 'BTC' },
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true },
      }),
      prisma.tradeDecision.findFirst({
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true },
      }),
      prisma.testnetAccount.findFirst({
        orderBy: { updated_at: 'desc' },
        select: { updated_at: true },
      }),
    ]);

    const activityTimes = [
      lastCandle?.timestamp,
      lastDecision?.timestamp,
      lastAccountTouch?.updated_at,
    ]
      .filter(Boolean)
      .map((t) => new Date(t as Date).getTime());
    const lastActivity = activityTimes.length ? new Date(Math.max(...activityTimes)) : null;

    const workerStatus = lastActivity
      ? Date.now() - lastActivity.getTime() < 300_000
        ? 'healthy'
        : 'stale'
      : 'idle';

    const btcOnlyScope = btcOnlyFromConfig();

    const now = new Date();
    const lockedAccounts = await prisma.testnetAccount.count({
      where: {
        OR: [{ cooldown_until: { gt: now } }, { precision_cooldown_until: { gt: now } }],
      },
    });

    const lockStatus = lockedAccounts > 0 ? 'locked' : 'unlocked';

    let safetyValidation = 'unknown';
    try {
      validateSafetyRequirements();
      safetyValidation = 'passed';
    } catch (e: any) {
      safetyValidation = `failed: ${e?.message || 'validation error'}`;
    }

    const systemHealth = {
      workerStatus,
      databaseStatus,
      safetyValidation,
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
    const MARKET_CRON = '*/5 * * * *';
    const LLM_CRON = '*/15 * * * *';
    const POS_CRON = '*/1 * * * *';

    const [lastBtcCandle, lastKimDecision, lastTradeEvent, lastOpenPosTouch] = await Promise.all([
      prisma.ohlcvCandle.findFirst({
        where: { coin: 'BTC' },
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true },
      }),
      prisma.tradeDecision.findFirst({
        where: { method_id: 'kim_nghia' },
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true },
      }),
      prisma.testnetTradeEvent.findFirst({
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true },
      }),
      prisma.testnetPosition.findFirst({
        where: { status: { in: ['open', 'OPEN'] } },
        orderBy: { entry_time: 'desc' },
        select: { entry_time: true },
      }),
    ]);

    const marketLast = lastBtcCandle?.timestamp ? new Date(lastBtcCandle.timestamp) : null;
    const llmLast = lastKimDecision?.timestamp ? new Date(lastKimDecision.timestamp) : null;
    const posTimes = [lastTradeEvent?.timestamp, lastOpenPosTouch?.entry_time]
      .filter(Boolean)
      .map((t) => new Date(t as Date).getTime());
    const posLast = posTimes.length ? new Date(Math.max(...posTimes)) : null;

    const schedulers = [
      {
        name: 'MarketScan',
        cron: MARKET_CRON,
        status: inferSchedulerStatus(marketLast, 6 * 60_000),
        lastRun: formatRelativeAgo(marketLast),
        lastRunAt: marketLast?.toISOString() ?? null,
        nextRun: estimateNextCronHint(marketLast, MARKET_CRON),
      },
      {
        name: 'LLMDispatch',
        cron: LLM_CRON,
        status: inferSchedulerStatus(llmLast, 20 * 60_000),
        lastRun: formatRelativeAgo(llmLast),
        lastRunAt: llmLast?.toISOString() ?? null,
        nextRun: estimateNextCronHint(llmLast, LLM_CRON),
      },
      {
        name: 'PositionMonitor',
        cron: POS_CRON,
        status: inferSchedulerStatus(posLast, 3 * 60_000),
        lastRun: formatRelativeAgo(posLast),
        lastRunAt: posLast?.toISOString() ?? null,
        nextRun: estimateNextCronHint(posLast, POS_CRON),
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
    const enabledMethods = Object.values(METHODS)
      .filter((m) => m.enabled)
      .map((m) => m.methodId);
    const disabledMethods = Object.values(METHODS)
      .filter((m) => !m.enabled)
      .map((m) => m.methodId);

    const scope = {
      btcOnly: btcOnlyFromConfig(),
      enabledMethods,
      disabledMethods,
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
      reasonCodes: toReasonCodes(decision.reason),
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
    const policy = getRiskPolicy();
    const accounts = await prisma.testnetAccount.findMany({
      where: { symbol: 'BTC' },
    });

    const account = accounts[0];
    const now = new Date();

    const lossCooldown = account?.cooldown_until && account.cooldown_until > now;
    const precisionCooldown = account?.precision_cooldown_until && account.precision_cooldown_until > now;
    const isLocked = Boolean(lossCooldown || precisionCooldown);

    let lockReason: string | null = null;
    if (lossCooldown) lockReason = 'Loss cooldown active (consecutive losses threshold)';
    else if (precisionCooldown) lockReason = 'Precision / API error cooldown active';

    const balanceBase = account?.current_balance || account?.equity || 0;
    const dailyLossCapUsd = balanceBase * (policy.dailyLossLimitPercent / 100);

    let dailyLossCurrent = 0;
    if (account) {
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const baseline = await prisma.testnetAccountSnapshot.findFirst({
        where: { account_id: account.id, timestamp: { lt: dayStart } },
        orderBy: { timestamp: 'desc' },
      });
      const startEquity = baseline?.equity ?? account.equity;
      const delta = (account.equity ?? 0) - startEquity;
      dailyLossCurrent = delta < 0 ? Math.abs(delta) : 0;
    }

    const riskState = {
      riskPerTrade: policy.riskPerTradePercent,
      dailyLossCap: dailyLossCapUsd,
      dailyLossLimitPercent: policy.dailyLossLimitPercent,
      dailyLossCurrent: dailyLossCurrent,
      maxConsecutiveLosses: policy.maxConsecutiveLosses,
      currentStreak: account?.consecutive_losses || 0,
      currentLockState: isLocked ? 'locked' : 'unlocked',
      lockReason,
      allowedReason: lockReason,
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
    const methodId = 'kim_nghia';
    const startUtc = new Date();
    startUtc.setUTCHours(0, 0, 0, 0);

    const decisionsToday = await prisma.tradeDecision.findMany({
      where: { method_id: methodId, timestamp: { gte: startUtc } },
      select: { reason: true, decision: true, timestamp: true },
    });

    let skippedCallCount = 0;
    let noTradeCount = 0;
    let invalidJsonCount = 0;
    let llmEngagedCount = 0;
    let lastEngaged: Date | null = null;

    for (const d of decisionsToday) {
      const r = d.reason || '';
      if (isSignalGateOnlyReason(r)) {
        skippedCallCount += 1;
        continue;
      }
      llmEngagedCount += 1;
      if (!lastEngaged || d.timestamp > lastEngaged) lastEngaged = d.timestamp;
      if (d.decision === 'no_trade') noTradeCount += 1;
      if (r.includes('LLM: invalid JSON') || r.includes('invalid or unparseable')) {
        invalidJsonCount += 1;
      }
    }

    const lastAny = await prisma.tradeDecision.findFirst({
      where: { method_id: methodId },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    });

    const lastCallTs = lastEngaged || lastAny?.timestamp || null;

    const recentAnalysis = await prisma.analysisHistory.findFirst({
      where: { coin: 'BTC', method_id: methodId },
      orderBy: { timestamp: 'desc' },
      select: { raw_answer: true },
    });

    const modelName =
      process.env.GROQ_MODEL_PRIMARY ||
      process.env.GROQ_MODEL ||
      'meta-llama/llama-4-scout-17b-16e-instruct';
    const promptVersion = process.env.PROMPT_VERSION || 'v3';

    const responseStatus =
      llmEngagedCount > 0 ? (invalidJsonCount > 0 ? 'degraded' : 'success') : recentAnalysis?.raw_answer ? 'success' : 'none';

    const llmStats = {
      callsToday: llmEngagedCount,
      lastCall: lastCallTs ? lastCallTs.toISOString() : null,
      modelName,
      promptVersion,
      responseStatus,
      invalidJsonCount,
      noTradeCount,
      skippedCallCount,
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
      result: (decision.trade_outcome?.outcome || 'pending').toUpperCase(),
      pnl: decision.trade_outcome?.realized_pnl || 0,
      date: decision.timestamp.toISOString(),
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
    const noTradeReasons = Object.entries(reasonCounts)
      .map(([reason, count]) => {
        let variant: 'warning' | 'danger' | 'default' = 'default';
        const rl = reason.toLowerCase();
        if (rl.includes('loss') || rl.includes('limit') || rl.includes('risk')) variant = 'danger';
        else if (rl.includes('insufficient') || rl.includes('spread') || rl.includes('candle')) variant = 'warning';
        return { reason, count, variant };
      })
      .sort((a, b) => b.count - a.count);

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
    const limit = Math.min(parseInt(String(req.query.limit || 20), 10) || 20, 100);
    const moduleFilter = typeof req.query.module === 'string' ? req.query.module.toLowerCase() : '';

    const [tradeEvents, decisions] = await Promise.all([
      prisma.testnetTradeEvent.findMany({
        orderBy: { timestamp: 'desc' },
        take: limit,
      }),
      prisma.tradeDecision.findMany({
        orderBy: { timestamp: 'desc' },
        take: Math.min(limit, 25),
        select: {
          id: true,
          timestamp: true,
          decision: true,
          reason: true,
          symbol: true,
          method_id: true,
        },
      }),
    ]);

    const fromEvents = tradeEvents.map((event) => ({
      id: `te-${event.id}`,
      timestamp: event.timestamp.toISOString(),
      module: 'Testnet',
      message: event.event_type,
      severity: (event.event_type.toLowerCase().includes('error') ? 'error' : 'info') as 'info' | 'warning' | 'error',
      details: event.event_data?.substring(0, 500) || '',
    }));

    const fromDecisions = decisions.map((d) => {
      const r = d.reason || '';
      let module = 'Decision';
      if (isSignalGateOnlyReason(r)) module = 'SignalGate';
      else if (r.startsWith('Risk engine:')) module = 'RiskEngine';
      else if (r.startsWith('LLM:')) module = 'LLM';
      const sev: 'info' | 'warning' | 'error' =
        d.decision === 'no_trade' && (r.includes('blocked') || r.includes('invalid')) ? 'warning' : 'info';
      return {
        id: `td-${d.id}`,
        timestamp: d.timestamp.toISOString(),
        module,
        message: `${d.symbol} ${d.decision}`,
        severity: sev,
        details: (d.reason || '').substring(0, 500),
        metadata: { method_id: d.method_id },
      };
    });

    let merged = [...fromEvents, ...fromDecisions].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    if (moduleFilter) {
      merged = merged.filter((e) => e.module.toLowerCase().includes(moduleFilter));
    }

    merged = merged.slice(0, limit);

    res.json({
      ok: true,
      data: merged,
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
        ok: true,
        success: true,
        data: {
          isInitialized: false,
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

    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const weekStart = new Date();
    weekStart.setUTCDate(weekStart.getUTCDate() - 7);
    weekStart.setUTCHours(0, 0, 0, 0);

    const [baselineDay, baselineWeek, marginAgg] = await Promise.all([
      prisma.testnetAccountSnapshot.findFirst({
        where: { account_id: account.id, timestamp: { lt: dayStart } },
        orderBy: { timestamp: 'desc' },
      }),
      prisma.testnetAccountSnapshot.findFirst({
        where: { account_id: account.id, timestamp: { lt: weekStart } },
        orderBy: { timestamp: 'desc' },
      }),
      prisma.testnetPosition.aggregate({
        where: {
          account_id: account.id,
          status: { in: ['open', 'OPEN'] },
        },
        _sum: { risk_usd: true },
      }),
    ]);

    const startDayEquity = baselineDay?.equity ?? account.equity;
    const startWeekEquity = baselineWeek?.equity ?? account.equity;
    const dailyPnL = (account.equity ?? 0) - startDayEquity;
    const weeklyPnL = (account.equity ?? 0) - startWeekEquity;

    const usedMargin = marginAgg._sum.risk_usd || 0;
    const equity = account.equity ?? account.current_balance ?? 0;
    const freeMargin = Math.max(0, equity - usedMargin);

    const balance = {
      isInitialized: true,
      totalBalance: account.current_balance || 0,
      availableBalance: Math.max(0, (account.current_balance || 0) - usedMargin),
      equity,
      usedMargin,
      freeMargin,
      dailyPnL,
      weeklyPnL,
    };

    res.json({
      ok: true,
      success: true,
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

    const positions = await prisma.testnetPosition.findMany({
      where: {
        status: { in: ['open', 'OPEN'] },
        ...(symbol ? { symbol: String(symbol).toUpperCase() } : {}),
        ...(method
          ? {
              account: {
                method_id: String(method),
              },
            }
          : {}),
      },
      orderBy: { entry_time: 'desc' },
    });

    const formattedPositions = positions.map((pos) => {
      const unrealizedPnL = pos.unrealized_pnl || 0;
      const entryPrice = pos.entry_price || 0;
      const pnlPercentage = entryPrice > 0 ? (unrealizedPnL / (entryPrice * (pos.size_qty || 1))) * 100 : 0;
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

    const orders = await prisma.testnetPendingOrder.findMany({
      where: {
        ...(symbol ? { symbol: String(symbol).toUpperCase() } : {}),
        ...(method ? { method_id: String(method) } : {}),
        ...(status ? { status: String(status) } : { status: { in: ['pending', 'PENDING'] } }),
      },
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

    const positions = await prisma.testnetPosition.findMany({
      where: {
        status: { in: ['closed', 'CLOSED'] },
        ...(symbol ? { symbol: String(symbol).toUpperCase() } : {}),
        ...(method
          ? {
              account: {
                method_id: String(method),
              },
            }
          : {}),
      },
      orderBy: { close_time: 'desc' },
      take: parseInt(limit as string, 10),
    });

    const formattedTrades = positions.map((pos) => ({
      id: pos.position_id,
      symbol: pos.symbol,
      side: pos.side,
      price: pos.close_price || pos.entry_price || 0,
      quantity: pos.size_qty || 0,
      fee: (pos.entry_fee || 0) + (pos.exit_fee || 0) + (pos.funding_fee || 0),
      realizedPnL: pos.realized_pnl || 0,
      status: pos.status,
      closedAt: pos.close_time?.toISOString() || '',
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

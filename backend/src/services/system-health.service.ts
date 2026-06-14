import { prisma } from '../lib/prisma';
import { validateSafetyRequirements } from '../config/app';
import { getRiskPolicy } from '../config/risk-policy';
import {
  V3_LLM_DISPATCH_CRON,
  V3_MARKET_SCAN_CRON,
  getV3WarmupRequiredCandles,
  getV3WarmupTimeframes,
} from '../config/v3-schedulers';
import {
  getPersistedSchedulerLastRun,
  getSchedulerLastRun,
} from '../utils/scheduler-heartbeat';
import { getDayBoundsICT } from '../utils/ict-time';

const POS_CRON = '*/1 * * * *';

export function formatRelativeAgo(ts: Date | null): string {
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
  return Date.now() - last.getTime() < staleAfterMs ? 'running' : 'stale';
}

export interface SchedulerStatusRow {
  name: string;
  cron: string;
  status: string;
  lastRun: string;
  lastRunAt: string | null;
}

export interface SystemHealthSnapshot {
  workerStatus: string;
  databaseStatus: string;
  safetyValidation: string;
  lockStatus: string;
  schedulers: SchedulerStatusRow[];
  warmup: {
    isWarmedUp: boolean;
    timeframes: Array<{ name: string; loaded: number; required: number }>;
  };
  risk: {
    dailyLossCurrent: number;
    dailyLossCapUsd: number;
    isLocked: boolean;
    lockReason: string | null;
  };
  binanceEnabled: boolean;
  recentErrors: Array<{ event_type: string; timestamp: string; summary: string }>;
}

export async function getSystemHealthSnapshot(): Promise<SystemHealthSnapshot> {
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

  const activityTimes = [lastCandle?.timestamp, lastDecision?.timestamp, lastAccountTouch?.updated_at]
    .filter(Boolean)
    .map((t) => new Date(t as Date).getTime());
  const lastActivity = activityTimes.length ? new Date(Math.max(...activityTimes)) : null;
  const workerStatus = lastActivity
    ? Date.now() - lastActivity.getTime() < 300_000
      ? 'healthy'
      : 'stale'
    : 'idle';

  let safetyValidation = 'unknown';
  try {
    validateSafetyRequirements();
    safetyValidation = 'passed';
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'validation error';
    safetyValidation = `failed: ${msg}`;
  }

  const now = new Date();
  const lockedAccounts = await prisma.testnetAccount.count({
    where: {
      OR: [{ cooldown_until: { gt: now } }, { precision_cooldown_until: { gt: now } }],
    },
  });
  const lockStatus = lockedAccounts > 0 ? 'locked' : 'unlocked';

  const [lastBtcCandle, lastKimDecision, persistedMarket, persistedLlm, persistedPos] =
    await Promise.all([
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
      getPersistedSchedulerLastRun('MarketScan'),
      getPersistedSchedulerLastRun('LLMDispatch'),
      getPersistedSchedulerLastRun('PositionMonitor'),
    ]);

  const marketHb = getSchedulerLastRun('MarketScan');
  const llmHb = getSchedulerLastRun('LLMDispatch');
  const posHb = getSchedulerLastRun('PositionMonitor');

  const marketLast =
    persistedMarket ??
    marketHb ??
    (lastBtcCandle?.timestamp ? new Date(lastBtcCandle.timestamp) : null);
  const llmLast =
    persistedLlm ??
    llmHb ??
    (lastKimDecision?.timestamp ? new Date(lastKimDecision.timestamp) : null);
  const posLast = persistedPos ?? posHb ?? null;

  const schedulers: SchedulerStatusRow[] = [
    {
      name: 'MarketScan',
      cron: V3_MARKET_SCAN_CRON,
      status: inferSchedulerStatus(marketLast, 6 * 60_000),
      lastRun: formatRelativeAgo(marketLast),
      lastRunAt: marketLast?.toISOString() ?? null,
    },
    {
      name: 'LLMDispatch',
      cron: V3_LLM_DISPATCH_CRON,
      status: inferSchedulerStatus(llmLast, 20 * 60_000),
      lastRun: formatRelativeAgo(llmLast),
      lastRunAt: llmLast?.toISOString() ?? null,
    },
    {
      name: 'PositionMonitor',
      cron: POS_CRON,
      status: inferSchedulerStatus(posLast, 3 * 60_000),
      lastRun: formatRelativeAgo(posLast),
      lastRunAt: posLast?.toISOString() ?? null,
    },
  ];

  const timeframes = getV3WarmupTimeframes();
  const requiredCandles = getV3WarmupRequiredCandles();
  const grouped = await prisma.ohlcvCandle.groupBy({
    by: ['timeframe'],
    where: { coin: 'BTC' },
    _count: { _all: true },
  });
  const countByTf = Object.fromEntries(grouped.map((row) => [row.timeframe, row._count._all])) as Record<
    string,
    number
  >;
  const tfStatus = timeframes.map((tf) => ({
    name: tf,
    loaded: countByTf[tf] ?? 0,
    required: requiredCandles[tf] ?? 100,
  }));
  const isWarmedUp = tfStatus.every((tf) => tf.loaded >= tf.required);

  const policy = getRiskPolicy();
  const account = await prisma.testnetAccount.findFirst({ where: { symbol: 'BTC' } });
  const balanceBase = account?.current_balance || account?.equity || 0;
  const dailyLossCapUsd = balanceBase * (policy.dailyLossLimitPercent / 100);

  let dailyLossCurrent = 0;
  let isLocked = false;
  let lockReason: string | null = null;
  if (account) {
    const { dayStart } = getDayBoundsICT();
    const baseline = await prisma.testnetAccountSnapshot.findFirst({
      where: { account_id: account.id, timestamp: { lt: dayStart } },
      orderBy: { timestamp: 'desc' },
    });
    const startEquity = baseline?.equity ?? account.equity ?? 0;
    const delta = (account.equity ?? 0) - startEquity;
    dailyLossCurrent = delta < 0 ? Math.abs(delta) : 0;

    const lossCooldown = account.cooldown_until && account.cooldown_until > now;
    const precisionCooldown = account.precision_cooldown_until && account.precision_cooldown_until > now;
    isLocked = Boolean(lossCooldown || precisionCooldown);
    if (lossCooldown) lockReason = 'Loss cooldown';
    else if (precisionCooldown) lockReason = 'Precision cooldown';
  }

  const events = await prisma.testnetTradeEvent.findMany({
    orderBy: { timestamp: 'desc' },
    take: 30,
  });
  const recentErrors = events
    .filter((e) => {
      const t = e.event_type.toLowerCase();
      return t.includes('error') || t.includes('reject') || t.includes('fail');
    })
    .slice(0, 5)
    .map((e) => ({
      event_type: e.event_type,
      timestamp: e.timestamp.toISOString(),
      summary: (e.event_data || '').slice(0, 120),
    }));

  const staleSchedulers = schedulers.filter((s) => s.status === 'stale').map((s) => s.name);
  if (staleSchedulers.length > 0) {
    recentErrors.unshift({
      event_type: 'scheduler_stale',
      timestamp: new Date().toISOString(),
      summary: staleSchedulers.join(', '),
    });
  }

  return {
    workerStatus,
    databaseStatus,
    safetyValidation,
    lockStatus,
    schedulers,
    warmup: { isWarmedUp, timeframes: tfStatus },
    risk: { dailyLossCurrent, dailyLossCapUsd, isLocked, lockReason },
    binanceEnabled: process.env.BINANCE_ENABLED === 'true',
    recentErrors,
  };
}

export async function getLlmStatsTodayIct(): Promise<{
  total: number;
  trades: number;
  noTrades: number;
}> {
  const { dayStart } = getDayBoundsICT();
  const decisions = await prisma.tradeDecision.findMany({
    where: { timestamp: { gte: dayStart }, method_id: 'kim_nghia' },
    select: { decision: true },
  });
  const trades = decisions.filter((d) => d.decision === 'trade').length;
  return { total: decisions.length, trades, noTrades: decisions.length - trades };
}

export async function getLastKimDecision(): Promise<{
  decision: string;
  reason: string | null;
  timestamp: Date;
} | null> {
  const row = await prisma.tradeDecision.findFirst({
    where: { method_id: 'kim_nghia' },
    orderBy: { timestamp: 'desc' },
    select: { decision: true, reason: true, timestamp: true },
  });
  return row ?? null;
}

export async function getTopNoTradeReasonsIct(limit = 3): Promise<Array<{ reason: string; count: number }>> {
  const { dayStart } = getDayBoundsICT();
  const rows = await prisma.tradeDecision.findMany({
    where: {
      timestamp: { gte: dayStart },
      decision: 'no_trade',
      method_id: 'kim_nghia',
    },
    select: { reason: true },
  });
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = (r.reason || 'unknown').slice(0, 80);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

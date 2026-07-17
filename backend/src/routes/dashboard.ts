import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import {
  readCache,
  DASHBOARD_READ_TTL_MS,
  DASHBOARD_EVENTS_TTL_MS,
  DASHBOARD_WARMUP_TTL_MS,
  ACCOUNT_BALANCE_TTL_MS,
} from '../lib/read-cache';
import { PIPELINE_EVENT_POSITION_ID } from '../repositories/testnet.repository';
import { isInternalCloseReason } from '../utils/bookkeeping-close';
import { fetchBinanceClosedTradeRounds } from '../services/binance-trade-history.service';
import { validateSafetyRequirements } from '../config/app';
import { getRiskPolicy } from '../config/risk-policy';
import { METHODS } from '../config/methods';
import { getCandles } from '../services/candle.service';
import { getV3LtfAlignRegimeHtf } from '../config/v3-entry-policy';
import { getSignalGateCandleLimit } from '../config/signal-gate-windows';
import type { MarketRegime } from '../analyzers/market-regime.analyzer';
import { signalGateService, type SignalGateOutput } from '../services/signal-gate.service';
import {
  V3_LLM_DISPATCH_CRON,
  V3_MARKET_SCAN_CRON,
  getV3SignalGateTimeframes,
  getV3WarmupRequiredCandles,
  getV3WarmupTimeframes,
} from '../config/v3-schedulers';
import {
  getPersistedSchedulerLastRun,
  getSchedulerLastRun,
  inferWorkerActivityStatus,
} from '../utils/scheduler-heartbeat';
import { compareSignalGateEvaluations } from '../utils/signal-gate-ranking';
import { calculatePnlPercent } from '../services/position-mark';
import { getAccountBalanceSummary, getLiveOpenPositionLines, getLivePendingOrderLines } from '../services/account-summary.service';
import { getGroqPrimaryModel } from '../config/groq-models';
import { isTelegramAiEnabled } from '../config/telegram-ai';
import { runTelegramAiQuery } from '../services/telegram/telegram-ai.service';
import type { AiContextScope } from '../services/telegram/ai-context.builder';
const router = Router();

function formatTimeInPosition(entry: Date | string | null | undefined): string {
  if (!entry) return '—';
  const ms = Date.now() - new Date(entry).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function formatLevel(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : '—';
}

function mapProtectiveTradeEvent(
  eventType: string,
  parsed: Record<string, unknown> | null,
  rawDetails: string
): { message: string; module: string; details: string; severity: 'info' | 'warning' | 'error' } | null {
  if (eventType === 'profit_protect_sl') {
    const action = String(parsed?.action ?? 'protect');
    const reason = String(parsed?.reason ?? '');
    return {
      module: 'PositionMonitor',
      message: `Profit protect — ${action}`,
      details: [
        `SL ${formatLevel(parsed?.old_sl)} → ${formatLevel(parsed?.new_sl)}`,
        reason,
      ]
        .filter(Boolean)
        .join('\n'),
      severity: 'info',
    };
  }
  if (eventType === 'position_invalidation') {
    const reason = String(parsed?.reason ?? '');
    const score = parsed?.score != null ? `score ${parsed.score}` : '';
    return {
      module: 'PositionMonitor',
      message: 'Invalidation — tighten BE',
      details: [
        `SL ${formatLevel(parsed?.old_sl)} → ${formatLevel(parsed?.new_sl)}`,
        score,
        reason,
      ]
        .filter(Boolean)
        .join('\n'),
      severity: 'warning',
    };
  }
  if (eventType.startsWith('protective_') || eventType.includes('emergency')) {
    return {
      module: 'Protective',
      message: eventType.replace(/_/g, ' '),
      details: rawDetails.substring(0, 500),
      severity: eventType.includes('fail') || eventType.includes('error') ? 'error' : 'warning',
    };
  }
  return null;
}

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

/** Rough next-fire hint for step or comma-minute crons (matches worker v3). */
function estimateNextCronHint(last: Date | null, cronExpr: string): string {
  if (!last) return '—';
  const part = cronExpr.trim().split(/\s+/)[0] || '';
  const stepMatch = part.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const stepMs = parseInt(stepMatch[1], 10) * 60_000;
    const elapsed = Date.now() - last.getTime();
    const until = Math.max(0, stepMs - (elapsed % stepMs || stepMs));
    const untilMin = Math.ceil(until / 60_000);
    if (untilMin <= 1) return 'within 1 min';
    return `~${untilMin} min`;
  }

  const minutes = part
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));
  if (minutes.length > 0) {
    const now = new Date();
    const currentMin = now.getUTCMinutes();
    const sorted = [...minutes].sort((a, b) => a - b);
    const nextInHour = sorted.find((m) => m > currentMin);
    const minsUntil =
      nextInHour !== undefined ? nextInHour - currentMin : 60 - currentMin + sorted[0];
    if (minsUntil <= 1) return 'within 1 min';
    return `~${minsUntil} min`;
  }

  return '—';
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

function parseExecutionBlockedReason(reason: string): string | null {
  const marker = '| Execution blocked:';
  const idx = reason.indexOf(marker);
  if (idx >= 0) return reason.slice(idx + marker.length).trim();
  if (reason.includes('Execution blocked:')) {
    return reason.split('Execution blocked:').pop()?.trim() || null;
  }
  return null;
}

/** Groq ran but risk engine rejected before trade row (SL / R:R pre-check). */
function isPreExecutionRiskBlock(reason: string): boolean {
  return reason.startsWith('Risk engine:') && reason.includes('LLM:');
}

function parsePreExecutionRiskDetail(reason: string): string {
  const body = reason.replace(/^Risk engine:\s*/, '').trim();
  const llmPart = body.includes('·') ? body.split('·').slice(1).join('·').trim() : '';
  const gatePart = body.split('·')[0]?.trim() || body;
  return [llmPart, `→ ${gatePart}`].filter(Boolean).join('\n');
}

function fmtEventPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function formatLevelsBlock(d: {
  entry_price?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
  expected_rr?: number | null;
}): string {
  const rr =
    d.expected_rr != null && Number.isFinite(Number(d.expected_rr))
      ? ` · R:R ${Number(d.expected_rr).toFixed(2)}`
      : '';
  return `Entry ${fmtEventPrice(d.entry_price)} · SL ${fmtEventPrice(d.stop_loss)} · TP ${fmtEventPrice(d.take_profit)}${rr}`;
}

function mapTradeDecisionToEvent(d: {
  id: number;
  timestamp: Date;
  symbol: string;
  decision: string;
  reason: string | null;
  method_id: string;
  entry_price?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
  expected_rr?: number | null;
}) {
  const r = d.reason || '';
  const execBlocked = parseExecutionBlockedReason(r);
  const preExecRisk = isPreExecutionRiskBlock(r);
  const isTrade = d.decision === 'trade';
  const levels = formatLevelsBlock(d);

  let module = 'LLM';
  if (isSignalGateOnlyReason(r)) module = 'SignalGate';
  else if (preExecRisk || execBlocked) module = 'Execution';
  else if (r.startsWith('Risk engine:')) module = 'RiskEngine';

  let message: string;
  if ((isTrade && execBlocked) || preExecRisk) {
    message = `${d.symbol} — LLM TRADE, không vào lệnh`;
  } else if (isTrade) {
    message = `${d.symbol} — LLM TRADE (đang/đã gửi lệnh)`;
  } else {
    message = `${d.symbol} — NO TRADE`;
  }

  let severity: 'info' | 'warning' | 'error' = 'info';
  if (execBlocked || preExecRisk) severity = 'warning';
  else if (!isTrade && (r.includes('blocked') || r.includes('invalid'))) severity = 'warning';

  let details: string;
  if (preExecRisk) {
    details = [parsePreExecutionRiskDetail(r), levels].filter(Boolean).join('\n');
  } else if (execBlocked) {
    const summary = r.split('| Execution blocked:')[0]?.trim();
    details = [summary || levels, levels, `→ ${execBlocked}`].filter(Boolean).join('\n');
  } else if (isTrade && (d.entry_price || d.stop_loss || d.take_profit)) {
    details = [r.includes('LLM:') ? r.split('| Execution blocked:')[0]?.trim() : r, levels]
      .filter(Boolean)
      .join('\n');
  } else if (isTrade && r === 'LLM decision') {
    details = 'LLM đã duyệt trade (log cũ — lý do execution chưa được ghi)';
    severity = 'warning';
  } else {
    details = r || levels;
  }

  return {
    id: `td-${d.id}`,
    timestamp: d.timestamp.toISOString(),
    module,
    message,
    severity,
    details: details.substring(0, 600),
    metadata: {
      method_id: d.method_id,
      decision: d.decision,
      entry: d.entry_price,
      stop_loss: d.stop_loss,
      take_profit: d.take_profit,
    },
  };
}

/**
 * GET /api/dashboard/system
 * Get system health and status summary
 */
router.get('/system', async (_req: Request, res: Response) => {
  try {
    const systemHealth = await readCache.get('dashboard:system', DASHBOARD_READ_TTL_MS, async () => {
    let databaseStatus = 'healthy';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      databaseStatus = 'error';
    }

    const workerStatus = await inferWorkerActivityStatus();

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

    return {
      workerStatus,
      databaseStatus,
      safetyValidation,
      btcOnlyScope,
      lockStatus,
    };
    });

    res.json({
      ok: true,
      data: systemHealth,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching system health:', error.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch system health' });
  }
});

/**
 * GET /api/dashboard/schedulers
 * Get scheduler status information
 */
router.get('/schedulers', async (_req: Request, res: Response) => {
  try {
    const schedulers = await readCache.get('dashboard:schedulers', DASHBOARD_READ_TTL_MS, async () => {
    const MARKET_CRON = V3_MARKET_SCAN_CRON;
    const LLM_CRON = V3_LLM_DISPATCH_CRON;
    const POS_CRON = '*/1 * * * *';

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

    return [
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
    });

    res.json({
      ok: true,
      data: schedulers,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching scheduler status:', error.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch scheduler status' });
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
  const timeframes = getV3WarmupTimeframes();
  const requiredMap = getV3WarmupRequiredCandles();
  const symbol = 'BTC';

  const emptyWarmup = () => ({
    totalCandles: 0,
    requiredCandles: timeframes.reduce((s, tf) => s + (requiredMap[tf] ?? 100), 0),
    isWarmedUp: false,
    timeframes: timeframes.map((name) => ({
      name,
      loaded: 0,
      required: requiredMap[name] ?? 100,
    })),
  });

  try {
    const data = await readCache.get('dashboard:warmup:BTC', DASHBOARD_WARMUP_TTL_MS, async () => {
      const grouped = await prisma.ohlcvCandle.groupBy({
        by: ['timeframe'],
        where: { coin: symbol },
        _count: { _all: true },
      });

      const countByTf = Object.fromEntries(
        grouped.map((row) => [row.timeframe, row._count._all])
      ) as Record<string, number>;

      const timeframeStatus = timeframes.map((tf) => ({
        name: tf,
        loaded: countByTf[tf] ?? 0,
        required: requiredMap[tf] ?? 100,
      }));

      const totalLoaded = timeframeStatus.reduce((sum, tf) => sum + tf.loaded, 0);
      const totalRequired = timeframeStatus.reduce((sum, tf) => sum + tf.required, 0);
      const isWarmedUp = timeframeStatus.every((tf) => tf.loaded >= tf.required);

      return {
        totalCandles: totalLoaded,
        requiredCandles: totalRequired,
        isWarmedUp,
        timeframes: timeframeStatus,
      };
    });

    res.json({
      ok: true,
      data,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching warmup status:', error.message);
    res.json({ ok: true, data: emptyWarmup() });
  }
});

async function buildLiveSignalGateView(symbol: string) {
  const evaluations: Array<{ timeframe: string; result: SignalGateOutput }> = [];
  const gateConfig = signalGateService.getConfig();
  let latestCandleMs = 0;

  const alignHtf = getV3LtfAlignRegimeHtf();
  const gateTfs = [...getV3SignalGateTimeframes()];
  const scanOrder = alignHtf
    ? [alignHtf, ...gateTfs.filter((t) => t !== alignHtf)]
    : gateTfs;
  let htfRegime: MarketRegime | null = null;

  for (const timeframe of scanOrder) {
    const { candles } = await getCandles({
      symbol,
      timeframe,
      limit: getSignalGateCandleLimit(timeframe),
    });
    if (candles.length < 50) continue;
    const lastTs = candles[candles.length - 1]?.timestamp;
    if (lastTs) {
      const ms = typeof lastTs === 'number' ? lastTs : new Date(lastTs).getTime();
      if (ms > latestCandleMs) latestCandleMs = ms;
    }
    const result = await signalGateService.evaluate({
      candles,
      symbol,
      timeframe,
      htfRegime: alignHtf && timeframe !== alignHtf ? htfRegime : undefined,
    });
    evaluations.push({ timeframe, result });
    if (alignHtf && timeframe === alignHtf) {
      htfRegime = result.setupResult.regime;
    }
  }

  if (evaluations.length === 0) return null;

  const sorted = [...evaluations].sort(compareSignalGateEvaluations);
  const best = sorted[0];
  const { timeframe, result } = best;

  const perTimeframe = sorted.map(({ timeframe: tf, result: r }) => ({
    timeframe: tf,
    grade: r.setupResult.grade,
    confidence: r.setupResult.confidence,
    regime: r.setupResult.regime,
    gateRegime: r.gateRegime ?? r.setupResult.regime,
    playbook: r.setupResult.playbookKey || 'none',
    pass: r.pass,
    setupReason: r.setupResult.reason,
    detailReason: r.setupResult.detailReason,
    gateReason: r.pass ? null : r.reason,
    evidence: r.setupResult.evidence,
  }));

  const reasonCodes: string[] = [];
  for (const row of perTimeframe) {
    if (row.pass) {
      const align =
        row.gateRegime !== row.regime ? ` · gate ${row.gateRegime} (LTF ${row.regime})` : '';
      reasonCodes.push(`${row.timeframe}: PASS · grade ${row.grade}${align}`);
    } else {
      const short =
        row.detailReason?.split('\n')[1]?.trim() ||
        row.setupReason ||
        'BLOCK';
      reasonCodes.push(`${row.timeframe}: BLOCK · grade ${row.grade} · ${short}`);
    }
  }
  reasonCodes.push(
    `Policy: grade ≥ ${gateConfig.minGrade}, conf ≥ ${(gateConfig.minConfidence * 100).toFixed(0)}%`
  );

  return {
    id: 'live',
    timeframe,
    grade: result.setupResult.grade,
    confidence: result.setupResult.confidence,
    playbook: result.setupResult.playbookKey || 'unknown',
    regime: result.setupResult.regime,
    pass: result.pass,
    setupReason: result.setupResult.reason,
    detailReason: result.setupResult.detailReason,
    evidence: result.setupResult.evidence,
    reasonCodes,
    evaluations: perTimeframe,
    /** Last closed candle time used for evaluation (not wall-clock). */
    timestamp: latestCandleMs
      ? new Date(latestCandleMs).toISOString()
      : new Date().toISOString(),
  };
}

function summarizeLastLlmDecision(decision: string, reason: string | null): string {
  const r = reason || '';
  if (r.includes('Execution blocked:')) {
    const block = r.split('Execution blocked:').pop()?.trim() || 'execution blocked';
    return `trade · chưa vào lệnh (${block})`;
  }
  if (isPreExecutionRiskBlock(r)) {
    const gate = r.replace(/^Risk engine:\s*/, '').split('·')[0]?.trim() || r;
    return `Groq OK · chưa vào lệnh (${gate})`;
  }
  if (r.startsWith('LLM:') || r.includes('LLM:')) return decision === 'trade' ? 'trade' : 'no_trade';
  if (r.startsWith('Risk engine')) return `no_trade · ${r.slice(0, 80)}`;
  return decision;
}

/**
 * GET /api/dashboard/signals
 * Get latest signal gate decisions (live evaluation + persisted history)
 */
router.get('/signals', async (req: Request, res: Response) => {
  try {
    const { limit = 5, symbol = 'BTC' } = req.query;
    const take = parseInt(String(limit), 10);
    const sym = String(symbol).toUpperCase();

    const signals = await readCache.get(
      `dashboard:signals:${sym}:${take}`,
      DASHBOARD_READ_TTL_MS,
      async () => {
    const live = await buildLiveSignalGateView(sym);

    const decisions = await prisma.tradeDecision.findMany({
      where: {
        OR: [
          { reason: { startsWith: 'Signal gate:' } },
          { reason: { startsWith: 'Signal gate blocked:' } },
        ],
      },
      orderBy: { timestamp: 'desc' },
      take: Math.max(take, 5),
    });

    const historical = decisions.map((decision) => ({
      id: decision.id.toString(),
      grade: decision.grade,
      confidence: decision.confidence,
      playbook: decision.playbook_key,
      regime: decision.regime,
      pass: decision.decision === 'trade',
      reasonCodes: toReasonCodes(decision.reason),
      timestamp: decision.timestamp.toISOString(),
    }));

    return live
      ? [live, ...historical.filter((h) => h.timestamp !== live.timestamp)].slice(0, take)
      : historical.slice(0, take);
      }
    );

    res.json({
      ok: true,
      data: signals,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching signals:', error.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch signals' });
  }
});

/**
 * GET /api/dashboard/risk
 * Get risk engine state
 */
router.get('/risk', async (_req: Request, res: Response) => {
  try {
    const riskState = await readCache.get('dashboard:risk:BTC', DASHBOARD_READ_TTL_MS, async () => {
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

    return {
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
    });

    res.json({
      ok: true,
      data: riskState,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching risk state:', error.message);
    const policy = getRiskPolicy();
    res.json({
      ok: true,
      data: {
        riskPerTrade: policy.riskPerTradePercent,
        dailyLossCap: 0,
        dailyLossLimitPercent: policy.dailyLossLimitPercent,
        dailyLossCurrent: 0,
        maxConsecutiveLosses: policy.maxConsecutiveLosses,
        currentStreak: 0,
        currentLockState: 'unknown',
        lockReason: null,
        allowedReason: null,
      },
    });
  }
});

/**
 * GET /api/dashboard/llm
 * Get LLM dispatch statistics
 */
router.get('/llm', async (_req: Request, res: Response) => {
  try {
    const llmStats = await readCache.get('dashboard:llm:kim_nghia', DASHBOARD_READ_TTL_MS, async () => {
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

    const lastLlmDecision = await prisma.tradeDecision.findFirst({
      where: {
        method_id: methodId,
        NOT: [
          { reason: { startsWith: 'Signal gate:' } },
          { reason: { startsWith: 'Signal gate blocked:' } },
        ],
      },
      orderBy: { timestamp: 'desc' },
      select: {
        decision: true,
        reason: true,
        timestamp: true,
        timeframe: true,
        grade: true,
      },
    });

    const lastCallTs = lastEngaged || lastLlmDecision?.timestamp || null;
    const lastEngagedSummary = lastLlmDecision
      ? summarizeLastLlmDecision(lastLlmDecision.decision, lastLlmDecision.reason)
      : null;

    const recentAnalysis = await prisma.analysisHistory.findFirst({
      where: { coin: 'BTC', method_id: methodId },
      orderBy: { timestamp: 'desc' },
      select: { raw_answer: true },
    });

    const modelName = getGroqPrimaryModel();
    const promptVersion = process.env.PROMPT_VERSION || 'v3';

    let responseStatus = 'none';
    if (llmEngagedCount > 0) {
      responseStatus = invalidJsonCount > 0 ? 'degraded' : 'success';
    } else if (lastLlmDecision?.reason?.includes('Execution blocked:')) {
      responseStatus = 'execution_blocked';
    } else if (lastLlmDecision?.decision === 'trade') {
      responseStatus = 'trade';
    } else if (lastLlmDecision) {
      responseStatus = 'no_trade';
    } else if (recentAnalysis?.raw_answer) {
      responseStatus = 'success';
    }

    return {
      callsToday: llmEngagedCount,
      lastCall: lastCallTs ? lastCallTs.toISOString() : null,
      lastEngagedSummary,
      lastDecision: lastLlmDecision?.decision ?? null,
      lastTimeframe: lastLlmDecision?.timeframe ?? null,
      modelName,
      promptVersion,
      responseStatus,
      invalidJsonCount,
      noTradeCount,
      skippedCallCount,
    };
    });

    res.json({
      ok: true,
      data: llmStats,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching LLM stats:', error.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch LLM stats' });
  }
});

/**
 * GET /api/dashboard/memory
 * Get memory-based insights
 */
router.get('/memory', async (_req: Request, res: Response) => {
  try {
    const memory = await readCache.get('dashboard:memory', DASHBOARD_READ_TTL_MS, async () => {
    // Get similar setups from recent trade decisions
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentDecisions = await prisma.tradeDecision.findMany({
      where: { timestamp: { gte: since } },
      orderBy: { timestamp: 'desc' },
      take: 10,
      include: { trade_outcome: true },
    });

    const withOutcomes = recentDecisions.filter((d) => d.trade_outcome != null);
    const similarSetups = (withOutcomes.length > 0 ? withOutcomes : recentDecisions)
      .slice(0, 5)
      .map((decision) => ({
        id: decision.id,
        playbook: decision.playbook_key,
        result: (decision.trade_outcome?.outcome || 'pending').toUpperCase(),
        pnl: decision.trade_outcome?.realized_pnl ?? 0,
        date: decision.timestamp.toISOString(),
      }));

    // Playbook stats with at least one recorded trade only
    const playbookStats = await prisma.playbookStats.findMany({
      where: { total_trades: { gt: 0 } },
    });
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

    return {
      similarSetups,
      playbookWinrate,
      failurePatterns,
    };
    });

    res.json({
      ok: true,
      data: memory,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching memory insights:', error.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch memory insights' });
  }
});

/**
 * GET /api/dashboard/no-trade-reasons
 * Get aggregated no-trade reasons
 */
router.get('/no-trade-reasons', async (_req: Request, res: Response) => {
  try {
    const noTradeReasons = await readCache.get(
      'dashboard:no-trade-reasons',
      DASHBOARD_READ_TTL_MS,
      async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Recent no_trade decisions only (last 24h) — avoid stale historical aggregates
    const recentDecisions = await prisma.tradeDecision.findMany({
      where: {
        decision: 'no_trade',
        timestamp: { gte: since },
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
    return Object.entries(reasonCounts)
      .map(([reason, count]) => {
        let variant: 'warning' | 'danger' | 'default' = 'default';
        const rl = reason.toLowerCase();
        if (rl.includes('loss') || rl.includes('limit') || rl.includes('risk')) variant = 'danger';
        else if (rl.includes('insufficient') || rl.includes('spread') || rl.includes('candle')) variant = 'warning';
        return { reason, count, variant };
      })
      .sort((a, b) => b.count - a.count);
      }
    );

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
    const page = Math.max(1, parseInt(String(req.query.page || 1), 10) || 1);
    const pageSize = Math.min(
      Math.max(1, parseInt(String(req.query.pageSize || req.query.limit || 8), 10) || 8),
      50
    );
    const moduleFilter = typeof req.query.module === 'string' ? req.query.module.toLowerCase() : '';
    const poolSize = 80;

    const payload = await readCache.get(
      `dashboard:events:${page}:${pageSize}:${moduleFilter}`,
      DASHBOARD_EVENTS_TTL_MS,
      async () => {
    const [tradeEvents, decisions] = await Promise.all([
      prisma.testnetTradeEvent.findMany({
        orderBy: { timestamp: 'desc' },
        take: poolSize,
      }),
      prisma.tradeDecision.findMany({
        orderBy: { timestamp: 'desc' },
        take: poolSize,
        select: {
          id: true,
          timestamp: true,
          decision: true,
          reason: true,
          symbol: true,
          method_id: true,
          entry_price: true,
          stop_loss: true,
          take_profit: true,
          expected_rr: true,
        },
      }),
    ]);

    const fromEvents = tradeEvents.map((event) => {
      const rawDetails = event.event_data;
      let parsed: Record<string, unknown> | null = null;
      if (typeof rawDetails === 'string' && rawDetails.startsWith('{')) {
        try {
          parsed = JSON.parse(rawDetails) as Record<string, unknown>;
        } catch {
          parsed = null;
        }
      }

      const isExecBlocked = event.event_type === 'execution_blocked';
      const rawDetailsStr =
        typeof rawDetails === 'string'
          ? rawDetails.substring(0, 500)
          : rawDetails != null
            ? JSON.stringify(rawDetails).substring(0, 500)
            : '';

      const mappedProtect = mapProtectiveTradeEvent(
        event.event_type,
        parsed,
        rawDetailsStr
      );

      let message = mappedProtect?.message ?? event.event_type;
      let details = mappedProtect?.details ?? rawDetailsStr;
      let module = mappedProtect?.module ?? 'Trading';
      let severity: 'info' | 'warning' | 'error' =
        mappedProtect?.severity ??
        (event.event_type.toLowerCase().includes('error') ? 'error' : 'info');

      if (isExecBlocked) {
        message = 'LLM TRADE — không vào lệnh';
        module = 'Execution';
        severity = 'warning';
        const blockReason =
          (parsed?.reason as string) ||
          (typeof parsed === 'object' && parsed ? details : 'Execution blocked');
        const sym = (parsed?.symbol as string) || '';
        const tf = (parsed?.timeframe as string) || '';
        const phase =
          parsed?.phase === 'pre_execution'
            ? '(sau Groq, trước Binance)'
            : parsed?.phase === 'binance_execution'
              ? '(sau Groq, lúc gửi lệnh)'
              : '';
        const levels = formatLevelsBlock({
          entry_price: parsed?.entry as number,
          stop_loss: parsed?.stop_loss as number,
          take_profit: parsed?.take_profit as number,
        });
        details = [
          sym && tf ? `${sym} ${tf} ${phase}`.trim() : sym,
          levels,
          `→ ${blockReason}`,
        ]
          .filter(Boolean)
          .join('\n');
      }

      return {
        id: `te-${event.id}`,
        timestamp: event.timestamp.toISOString(),
        module,
        message,
        severity,
        details,
      };
    });

    const fromDecisions = decisions.map((d) => mapTradeDecisionToEvent(d));

    let merged = [...fromEvents, ...fromDecisions].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    if (moduleFilter) {
      merged = merged.filter((e) => e.module.toLowerCase().includes(moduleFilter));
    }

    const total = merged.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const data = merged.slice(start, start + pageSize);

    return {
      data,
      pagination: {
        page: safePage,
        pageSize,
        total,
        totalPages,
      },
    };
      }
    );

    res.json({
      ok: true,
      data: payload.data,
      pagination: payload.pagination,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching events:', error.message);
    res.json({ ok: true, data: [] });
  }
});

/**
 * GET /api/account/balance
 * Get account balance information
 */
router.get('/balance', async (req: Request, res: Response) => {
  try {
    const { symbol = 'BTC', method = 'kim_nghia' } = req.query;
    const sym = String(symbol);
    const meth = String(method);

    const balance = await readCache.get(
      `account:balance:${sym}:${meth}`,
      ACCOUNT_BALANCE_TTL_MS,
      async () => {
        const summary = await getAccountBalanceSummary(sym, meth, false);
        if (!summary.isInitialized) {
          return {
            isInitialized: false,
            totalBalance: 0,
            availableBalance: 0,
            equity: 0,
            usedMargin: 0,
            freeMargin: 0,
            dailyPnL: 0,
            weeklyPnL: 0,
          };
        }
        const {
          symbol: _s,
          methodId: _m,
          openUnrealized: _u,
          exposureUsd: _e,
          maxExposureUsd: _x,
          ...apiBalance
        } = summary;
        return apiBalance;
      }
    );

    res.json({
      ok: true,
      success: true,
      data: balance,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching balance:', error.message);
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
  }
});

/**
 * GET /api/account/positions
 * Get open positions
 */
router.get('/positions', async (req: Request, res: Response) => {
  try {
    const { symbol, method } = req.query;
    const sym = symbol ? String(symbol).toUpperCase() : undefined;
    const methodId = method ? String(method) : 'kim_nghia';

    const positions = await getLiveOpenPositionLines(sym, methodId);

    const formattedPositions = positions.map((pos) => {
      const pnlPercentage = calculatePnlPercent(pos.side, pos.entry, pos.mark);
      const stopLoss = pos.stopLoss != null && pos.stopLoss > 0 ? pos.stopLoss : null;
      const takeProfit = pos.takeProfit != null && pos.takeProfit > 0 ? pos.takeProfit : null;
      return {
        id: pos.positionId,
        symbol: pos.symbol,
        side: pos.side,
        size: pos.sizeQty,
        entryPrice: pos.entry,
        markPrice: pos.mark,
        unrealizedPnL: pos.unrealizedPnl,
        pnlPercentage: pnlPercentage.toFixed(2),
        stopLoss,
        takeProfit,
        timeInPosition: formatTimeInPosition(pos.entryTime),
        source: 'binance',
      };
    });

    res.json({
      ok: true,
      data: formattedPositions,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching positions:', error.message);
    res.json({ ok: true, data: [] });
  }
});

/**
 * GET /api/account/orders
 * Get active orders
 */
router.get('/orders', async (req: Request, res: Response) => {
  try {
    const { symbol, method } = req.query;
    const sym = symbol ? String(symbol).toUpperCase() : undefined;
    const methodId = method ? String(method) : 'kim_nghia';

    const orders = await getLivePendingOrderLines(sym, methodId);

    const formattedOrders = orders.map((order) => ({
      id: order.orderId,
      symbol: order.symbol,
      side: order.side,
      type: 'LIMIT',
      status: order.status,
      price: order.entry,
      quantity: order.quantity ?? 0,
      reduceOnly: order.reduceOnly ?? false,
      createdAt: order.createdAt ?? new Date().toISOString(),
      source: 'binance',
    }));

    res.json({
      ok: true,
      data: formattedOrders,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching orders:', error.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch orders' });
  }
});

/**
 * GET /api/account/trades
 * Get trade history
 */
router.get('/trades', async (req: Request, res: Response) => {
  try {
    const { limit = 20, symbol, method } = req.query;
    const take = parseInt(limit as string, 10);
    const sym = symbol ? String(symbol).toUpperCase() : undefined;

    if (process.env.BINANCE_ENABLED === 'true' && sym) {
      try {
        const rounds = await fetchBinanceClosedTradeRounds(sym, take);
        res.json({ ok: true, data: rounds });
        return;
      } catch (binanceErr: unknown) {
        const msg = binanceErr instanceof Error ? binanceErr.message : String(binanceErr);
        console.warn(`[Dashboard] Binance trades for ${sym} failed, using DB: ${msg}`);
      }
    }

    const positions = await prisma.testnetPosition.findMany({
      where: {
        status: { in: ['closed', 'CLOSED'] },
        position_id: { not: PIPELINE_EVENT_POSITION_ID },
        side: { not: 'NONE' },
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
      take,
    });

    const formattedTrades = positions
      .filter((pos) => !isInternalCloseReason(pos.close_reason))
      .map((pos) => ({
      id: pos.position_id,
      symbol: pos.symbol,
      side: pos.side,
      entryPrice: pos.entry_price || 0,
      closePrice: pos.close_price || pos.entry_price || 0,
      quantity: pos.size_qty || 0,
      fee: (pos.entry_fee || 0) + (pos.exit_fee || 0) + (pos.funding_fee || 0),
      realizedPnL: pos.realized_pnl || 0,
      closeReason: pos.close_reason || undefined,
      status: pos.status,
      closedAt: pos.close_time?.toISOString() || '',
    }));

    res.json({
      ok: true,
      data: formattedTrades,
    });
  } catch (error: any) {
    console.error('[Dashboard] Error fetching trades:', error.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch trades' });
  }
});

const AI_SCOPES: AiContextScope[] = [
  'today_run',
  'errors',
  'pipeline',
  'llm',
  'compare',
  'freeform',
];

router.get('/telegram-ai/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      enabled: isTelegramAiEnabled(),
      scopes: AI_SCOPES,
    },
  });
});

router.post('/telegram-ai/query', async (req: Request, res: Response): Promise<void> => {
  if (!isTelegramAiEnabled()) {
    res.status(403).json({ success: false, error: 'Telegram AI is disabled' });
    return;
  }

  const scope = (req.body?.scope as AiContextScope) || 'today_run';
  const question = typeof req.body?.question === 'string' ? req.body.question : undefined;

  if (!AI_SCOPES.includes(scope)) {
    res.status(400).json({ success: false, error: 'Invalid scope' });
    return;
  }

  if (scope === 'freeform' && !question?.trim()) {
    res.status(400).json({ success: false, error: 'question required for freeform scope' });
    return;
  }

  try {
    const result = await runTelegramAiQuery(scope, question?.trim());
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const read_cache_1 = require("../lib/read-cache");
const testnet_repository_1 = require("../repositories/testnet.repository");
const binance_trade_history_service_1 = require("../services/binance-trade-history.service");
const cron_next_run_1 = require("../utils/cron-next-run");
const app_1 = require("../config/app");
const risk_policy_1 = require("../config/risk-policy");
const account_circuit_service_1 = require("../services/account-circuit.service");
const methods_1 = require("../config/methods");
const candle_service_1 = require("../services/candle.service");
const v3_entry_policy_1 = require("../config/v3-entry-policy");
const signal_gate_windows_1 = require("../config/signal-gate-windows");
const signal_gate_service_1 = require("../services/signal-gate.service");
const v3_schedulers_1 = require("../config/v3-schedulers");
const scheduler_heartbeat_1 = require("../utils/scheduler-heartbeat");
const signal_gate_ranking_1 = require("../utils/signal-gate-ranking");
const closed_candles_1 = require("../utils/closed-candles");
const position_mark_1 = require("../services/position-mark");
const account_summary_service_1 = require("../services/account-summary.service");
const groq_models_1 = require("../config/groq-models");
const openrouter_models_1 = require("../config/openrouter-models");
const telegram_ai_1 = require("../config/telegram-ai");
const telegram_ai_service_1 = require("../services/telegram/telegram-ai.service");
const account_performance_service_1 = require("../services/account-performance.service");
const router = (0, express_1.Router)();
function formatTimeInPosition(entry) {
    if (!entry)
        return '—';
    const ms = Date.now() - new Date(entry).getTime();
    if (!Number.isFinite(ms) || ms < 0)
        return '—';
    const mins = Math.floor(ms / 60_000);
    if (mins < 60)
        return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 48)
        return `${hours}h ${mins % 60}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
}
function formatLevel(v) {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n.toFixed(2) : '—';
}
function mapProtectiveTradeEvent(eventType, parsed, rawDetails) {
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
        const action = String(parsed?.action ?? 'exit');
        if (action === 'exit') {
            return {
                module: 'PositionMonitor',
                message: 'Invalidation — early exit',
                details: [score, reason].filter(Boolean).join('\n'),
                severity: 'warning',
            };
        }
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
function formatRelativeAgo(ts) {
    if (!ts)
        return 'never';
    const ms = Date.now() - ts.getTime();
    if (ms < 45_000)
        return 'just now';
    const mins = Math.floor(ms / 60_000);
    if (mins < 120)
        return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 48)
        return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}
function inferSchedulerStatus(last, staleAfterMs) {
    if (!last)
        return 'idle';
    return Date.now() - last.getTime() < staleAfterMs ? 'running' : 'idle';
}
function toReasonCodes(reason) {
    if (!reason || !reason.trim())
        return [];
    const byNl = reason
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
    if (byNl.length > 1)
        return byNl;
    const bySemi = reason
        .split(/;\s*/)
        .map((s) => s.trim())
        .filter(Boolean);
    if (bySemi.length > 1)
        return bySemi;
    return [reason.trim()];
}
function btcOnlyFromConfig() {
    if (process.env.BTC_ONLY === 'true')
        return true;
    const enabled = Object.values(methods_1.METHODS).filter((m) => m.enabled);
    if (enabled.length === 0)
        return false;
    return !enabled.some((m) => m.autoEntry?.enabledSymbols?.includes('ETH'));
}
function isSignalGateOnlyReason(reason) {
    const r = reason || '';
    return r.startsWith('Signal gate:') || r.startsWith('Signal gate blocked:');
}
function parseExecutionBlockedReason(reason) {
    const marker = '| Execution blocked:';
    const idx = reason.indexOf(marker);
    if (idx >= 0)
        return reason.slice(idx + marker.length).trim();
    if (reason.includes('Execution blocked:')) {
        return reason.split('Execution blocked:').pop()?.trim() || null;
    }
    return null;
}
/** Groq ran but risk engine rejected before trade row (SL / R:R pre-check). */
function isPreExecutionRiskBlock(reason) {
    return reason.startsWith('Risk engine:') && reason.includes('LLM:');
}
function parsePreExecutionRiskDetail(reason) {
    const body = reason.replace(/^Risk engine:\s*/, '').trim();
    const llmPart = body.includes('·') ? body.split('·').slice(1).join('·').trim() : '';
    const gatePart = body.split('·')[0]?.trim() || body;
    return [llmPart, `→ ${gatePart}`].filter(Boolean).join('\n');
}
function fmtEventPrice(n) {
    if (n == null || !Number.isFinite(Number(n)))
        return '—';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}
function formatLevelsBlock(d) {
    const rr = d.expected_rr != null && Number.isFinite(Number(d.expected_rr))
        ? ` · R:R ${Number(d.expected_rr).toFixed(2)}`
        : '';
    return `Entry ${fmtEventPrice(d.entry_price)} · SL ${fmtEventPrice(d.stop_loss)} · TP ${fmtEventPrice(d.take_profit)}${rr}`;
}
function mapTradeDecisionToEvent(d) {
    const r = d.reason || '';
    const execBlocked = parseExecutionBlockedReason(r);
    const preExecRisk = isPreExecutionRiskBlock(r);
    const isTrade = d.decision === 'trade';
    const levels = formatLevelsBlock(d);
    let module = 'LLM';
    if (isSignalGateOnlyReason(r))
        module = 'SignalGate';
    else if (preExecRisk || execBlocked)
        module = 'Execution';
    else if (r.startsWith('Risk engine:'))
        module = 'RiskEngine';
    let message;
    if ((isTrade && execBlocked) || preExecRisk) {
        message = `${d.symbol} — LLM TRADE, không vào lệnh`;
    }
    else if (isTrade) {
        message = `${d.symbol} — LLM TRADE (đang/đã gửi lệnh)`;
    }
    else {
        message = `${d.symbol} — NO TRADE`;
    }
    let severity = 'info';
    if (execBlocked || preExecRisk)
        severity = 'warning';
    else if (!isTrade && (r.includes('blocked') || r.includes('invalid')))
        severity = 'warning';
    let details;
    if (preExecRisk) {
        details = [parsePreExecutionRiskDetail(r), levels].filter(Boolean).join('\n');
    }
    else if (execBlocked) {
        const summary = r.split('| Execution blocked:')[0]?.trim();
        details = [summary || levels, levels, `→ ${execBlocked}`].filter(Boolean).join('\n');
    }
    else if (isTrade && (d.entry_price || d.stop_loss || d.take_profit)) {
        details = [r.includes('LLM:') ? r.split('| Execution blocked:')[0]?.trim() : r, levels]
            .filter(Boolean)
            .join('\n');
    }
    else if (isTrade && r === 'LLM decision') {
        details = 'LLM đã duyệt trade (log cũ — lý do execution chưa được ghi)';
        severity = 'warning';
    }
    else {
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
router.get('/system', async (_req, res) => {
    try {
        const systemHealth = await read_cache_1.readCache.get('dashboard:system', read_cache_1.DASHBOARD_READ_TTL_MS, async () => {
            let databaseStatus = 'healthy';
            try {
                await prisma_1.prisma.$queryRaw `SELECT 1`;
            }
            catch {
                databaseStatus = 'error';
            }
            const workerStatus = await (0, scheduler_heartbeat_1.inferWorkerActivityStatus)();
            const btcOnlyScope = btcOnlyFromConfig();
            const now = new Date();
            const lockedAccounts = await prisma_1.prisma.testnetAccount.count({
                where: {
                    OR: [{ cooldown_until: { gt: now } }, { precision_cooldown_until: { gt: now } }],
                },
            });
            const lockStatus = lockedAccounts > 0 ? 'locked' : 'unlocked';
            let safetyValidation = 'unknown';
            try {
                (0, app_1.validateSafetyRequirements)();
                safetyValidation = 'passed';
            }
            catch (e) {
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
    }
    catch (error) {
        console.error('[Dashboard] Error fetching system health:', error.message);
        res.status(500).json({ ok: false, error: 'Failed to fetch system health' });
    }
});
/**
 * GET /api/dashboard/schedulers
 * Get scheduler status information
 */
router.get('/schedulers', async (_req, res) => {
    try {
        const schedulers = await read_cache_1.readCache.get('dashboard:schedulers', read_cache_1.DASHBOARD_READ_TTL_MS, async () => {
            const MARKET_CRON = v3_schedulers_1.V3_MARKET_SCAN_CRON;
            const LLM_CRON = v3_schedulers_1.V3_LLM_DISPATCH_CRON;
            const POS_CRON = '*/1 * * * *';
            const [lastBtcCandle, lastKimDecision, persistedMarket, persistedLlm, persistedPos] = await Promise.all([
                prisma_1.prisma.ohlcvCandle.findFirst({
                    where: { coin: 'BTC' },
                    orderBy: { timestamp: 'desc' },
                    select: { timestamp: true },
                }),
                prisma_1.prisma.tradeDecision.findFirst({
                    where: { method_id: 'kim_nghia' },
                    orderBy: { timestamp: 'desc' },
                    select: { timestamp: true },
                }),
                (0, scheduler_heartbeat_1.getPersistedSchedulerLastRun)('MarketScan'),
                (0, scheduler_heartbeat_1.getPersistedSchedulerLastRun)('LLMDispatch'),
                (0, scheduler_heartbeat_1.getPersistedSchedulerLastRun)('PositionMonitor'),
            ]);
            const marketHb = (0, scheduler_heartbeat_1.getSchedulerLastRun)('MarketScan');
            const llmHb = (0, scheduler_heartbeat_1.getSchedulerLastRun)('LLMDispatch');
            const posHb = (0, scheduler_heartbeat_1.getSchedulerLastRun)('PositionMonitor');
            const marketLast = persistedMarket ??
                marketHb ??
                (lastBtcCandle?.timestamp ? new Date(lastBtcCandle.timestamp) : null);
            const llmLast = persistedLlm ??
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
                    nextRun: (0, cron_next_run_1.estimateNextCronHint)(marketLast, MARKET_CRON),
                },
                {
                    name: 'LLMDispatch',
                    cron: LLM_CRON,
                    status: inferSchedulerStatus(llmLast, 20 * 60_000),
                    lastRun: formatRelativeAgo(llmLast),
                    lastRunAt: llmLast?.toISOString() ?? null,
                    nextRun: (0, cron_next_run_1.estimateNextCronHint)(llmLast, LLM_CRON),
                },
                {
                    name: 'PositionMonitor',
                    cron: POS_CRON,
                    status: inferSchedulerStatus(posLast, 3 * 60_000),
                    lastRun: formatRelativeAgo(posLast),
                    lastRunAt: posLast?.toISOString() ?? null,
                    nextRun: (0, cron_next_run_1.estimateNextCronHint)(posLast, POS_CRON),
                },
            ];
        });
        res.json({
            ok: true,
            data: schedulers,
        });
    }
    catch (error) {
        console.error('[Dashboard] Error fetching scheduler status:', error.message);
        res.status(500).json({ ok: false, error: 'Failed to fetch scheduler status' });
    }
});
/**
 * GET /api/dashboard/scope
 * Get BTC-only scope status
 */
router.get('/scope', async (_req, res) => {
    try {
        const enabledMethods = Object.values(methods_1.METHODS)
            .filter((m) => m.enabled)
            .map((m) => m.methodId);
        const disabledMethods = Object.values(methods_1.METHODS)
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
    }
    catch (error) {
        console.error('[Dashboard] Error fetching scope status:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch scope status' });
    }
});
/**
 * GET /api/dashboard/warmup
 * Get candle warmup progress
 */
router.get('/warmup', async (_req, res) => {
    const timeframes = (0, v3_schedulers_1.getV3WarmupTimeframes)();
    const requiredMap = (0, v3_schedulers_1.getV3WarmupRequiredCandles)();
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
        const data = await read_cache_1.readCache.get('dashboard:warmup:BTC', read_cache_1.DASHBOARD_WARMUP_TTL_MS, async () => {
            const grouped = await prisma_1.prisma.ohlcvCandle.groupBy({
                by: ['timeframe'],
                where: { coin: symbol },
                _count: { _all: true },
            });
            const countByTf = Object.fromEntries(grouped.map((row) => [row.timeframe, row._count._all]));
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
    }
    catch (error) {
        console.error('[Dashboard] Error fetching warmup status:', error.message);
        res.json({ ok: true, data: emptyWarmup() });
    }
});
async function buildLiveSignalGateView(symbol) {
    const evaluations = [];
    const gateConfig = signal_gate_service_1.signalGateService.getConfig();
    let latestCandleMs = 0;
    const alignHtf = (0, v3_entry_policy_1.getV3LtfAlignRegimeHtf)();
    const gateTfs = [...(0, v3_schedulers_1.getV3SignalGateTimeframes)()];
    const scanOrder = alignHtf
        ? [alignHtf, ...gateTfs.filter((t) => t !== alignHtf)]
        : gateTfs;
    let htfRegime = null;
    for (const timeframe of scanOrder) {
        const { candles: fetchedCandles } = await (0, candle_service_1.getCandles)({
            symbol,
            timeframe,
            limit: (0, signal_gate_windows_1.getSignalGateCandleLimit)(timeframe),
        });
        const candles = (0, closed_candles_1.closedCandlesOnly)(fetchedCandles, timeframe);
        if (candles.length < 50)
            continue;
        const lastTs = candles[candles.length - 1]?.timestamp;
        if (lastTs) {
            const ms = typeof lastTs === 'number' ? lastTs : new Date(lastTs).getTime();
            if (ms > latestCandleMs)
                latestCandleMs = ms;
        }
        const result = await signal_gate_service_1.signalGateService.evaluate({
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
    if (evaluations.length === 0)
        return null;
    const sorted = [...evaluations].sort(signal_gate_ranking_1.compareSignalGateEvaluations);
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
    const reasonCodes = [];
    for (const row of perTimeframe) {
        if (row.pass) {
            const align = row.gateRegime !== row.regime ? ` · gate ${row.gateRegime} (LTF ${row.regime})` : '';
            reasonCodes.push(`${row.timeframe}: PASS · grade ${row.grade}${align}`);
        }
        else {
            const short = row.detailReason?.split('\n')[1]?.trim() ||
                row.setupReason ||
                'BLOCK';
            reasonCodes.push(`${row.timeframe}: BLOCK · grade ${row.grade} · ${short}`);
        }
    }
    reasonCodes.push(`Policy: grade ≥ ${gateConfig.minGrade}, conf ≥ ${(gateConfig.minConfidence * 100).toFixed(0)}%`);
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
function summarizeLastLlmDecision(decision, reason) {
    const r = reason || '';
    if (r.includes('Execution blocked:')) {
        const block = r.split('Execution blocked:').pop()?.trim() || 'execution blocked';
        return `trade · chưa vào lệnh (${block})`;
    }
    if (isPreExecutionRiskBlock(r)) {
        const gate = r.replace(/^Risk engine:\s*/, '').split('·')[0]?.trim() || r;
        return `Groq OK · chưa vào lệnh (${gate})`;
    }
    if (r.startsWith('LLM:') || r.includes('LLM:'))
        return decision === 'trade' ? 'trade' : 'no_trade';
    if (r.startsWith('Risk engine'))
        return `no_trade · ${r.slice(0, 80)}`;
    return decision;
}
/**
 * GET /api/dashboard/signals
 * Get latest signal gate decisions (live evaluation + persisted history)
 */
router.get('/signals', async (req, res) => {
    try {
        const { limit = 5, symbol = 'BTC' } = req.query;
        const take = parseInt(String(limit), 10);
        const sym = String(symbol).toUpperCase();
        const signals = await read_cache_1.readCache.get(`dashboard:signals:${sym}:${take}`, read_cache_1.DASHBOARD_READ_TTL_MS, async () => {
            const live = await buildLiveSignalGateView(sym);
            const decisions = await prisma_1.prisma.tradeDecision.findMany({
                where: {
                    OR: [
                        { reason: { startsWith: 'Signal gate:' } },
                        { reason: { startsWith: 'Signal gate blocked:' } },
                        { reason: { startsWith: 'Pre-LLM' } },
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
        });
        res.json({
            ok: true,
            data: signals,
        });
    }
    catch (error) {
        console.error('[Dashboard] Error fetching signals:', error.message);
        res.status(500).json({ ok: false, error: 'Failed to fetch signals' });
    }
});
/**
 * GET /api/dashboard/risk
 * Get risk engine state
 */
router.get('/risk', async (_req, res) => {
    try {
        const riskState = await read_cache_1.readCache.get('dashboard:risk:BTC', read_cache_1.DASHBOARD_READ_TTL_MS, async () => {
            const policy = (0, risk_policy_1.getRiskPolicy)();
            const account = await prisma_1.prisma.testnetAccount.findFirst({
                where: { symbol: 'BTC', method_id: 'kim_nghia' },
            });
            const now = new Date();
            const circuit = account ? await (0, account_circuit_service_1.getAccountCircuitStatus)(account.id) : null;
            const fullHistory = account ? await (0, account_performance_service_1.getFullHistoryWalletMetrics)(prisma_1.prisma, account) : null;
            const lossCooldown = account?.cooldown_until && account.cooldown_until > now;
            const precisionCooldown = account?.precision_cooldown_until && account.precision_cooldown_until > now;
            const isLocked = Boolean(lossCooldown || precisionCooldown || (circuit && !circuit.allowed));
            let lockReason = null;
            if (circuit && !circuit.allowed)
                lockReason = circuit.reason;
            else if (lossCooldown)
                lockReason = 'Loss cooldown active (consecutive losses threshold)';
            else if (precisionCooldown)
                lockReason = 'Precision / API error cooldown active';
            const balanceBase = account?.current_balance || account?.equity || 0;
            const dailyLossCapUsd = balanceBase * (policy.dailyLossLimitPercent / 100);
            const dailyLossCurrent = circuit?.dailyLossUsd ?? 0;
            return {
                riskPerTrade: policy.riskPerTradePercent,
                maxEffectiveRiskPerTrade: policy.maxEffectiveRiskPerTradePercent,
                maxEffectiveRiskPerTradeUsd: policy.maxEffectiveRiskPerTradeUsd ?? null,
                effectiveRiskCapMode: policy.maxEffectiveRiskPerTradeUsd ? 'usd' : 'percent',
                dailyLossCap: dailyLossCapUsd,
                dailyLossLimitPercent: policy.dailyLossLimitPercent,
                dailyLossCurrent: dailyLossCurrent,
                maxDrawdownPercent: policy.maxDrawdownPercent,
                drawdownPercent: fullHistory?.currentDrawdownPercent ?? 0,
                maxObservedDrawdownPercent: fullHistory?.maxDrawdownPercent ?? 0,
                peakEquity: fullHistory?.peakEquity ?? 0,
                walletPnl: fullHistory?.walletPnl ?? 0,
                walletReturnPercent: fullHistory?.walletReturnPercent ?? 0,
                expectancy: circuit?.expectancy ?? null,
                expectancyScope: circuit?.scope ?? 'strategy_epoch',
                fullHistory: fullHistory
                    ? {
                        scope: fullHistory.scope,
                        baselineBalance: fullHistory.baselineBalance,
                        currentBalance: fullHistory.currentBalance,
                        currentEquity: fullHistory.currentEquity,
                        walletPnl: fullHistory.walletPnl,
                        walletReturnPercent: fullHistory.walletReturnPercent,
                        peakEquity: fullHistory.peakEquity,
                        peakEquityAt: fullHistory.peakEquityAt,
                        currentDrawdownPercent: fullHistory.currentDrawdownPercent,
                        maxDrawdownPercent: fullHistory.maxDrawdownPercent,
                        maxDrawdownAt: fullHistory.maxDrawdownAt,
                        firstSnapshotAt: fullHistory.firstSnapshotAt,
                        lastSnapshotAt: fullHistory.lastSnapshotAt,
                        snapshotCount: fullHistory.snapshotCount,
                    }
                    : null,
                strategyEpoch: circuit
                    ? {
                        scope: circuit.scope,
                        startsAt: circuit.epochStart,
                        peakEquity: circuit.peakEquity,
                        peakEquitySource: circuit.peakEquitySource,
                        drawdownPercent: circuit.drawdownPercent,
                        expectancySince: circuit.expectancySince,
                        expectancy: circuit.expectancy,
                        tradingAllowed: circuit.allowed,
                        circuitReason: circuit.reason,
                    }
                    : null,
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
    }
    catch (error) {
        console.error('[Dashboard] Error fetching risk state:', error.message);
        const policy = (0, risk_policy_1.getRiskPolicy)();
        res.json({
            ok: true,
            data: {
                riskPerTrade: policy.riskPerTradePercent,
                maxEffectiveRiskPerTrade: policy.maxEffectiveRiskPerTradePercent,
                maxEffectiveRiskPerTradeUsd: policy.maxEffectiveRiskPerTradeUsd ?? null,
                effectiveRiskCapMode: policy.maxEffectiveRiskPerTradeUsd ? 'usd' : 'percent',
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
router.get('/llm', async (_req, res) => {
    try {
        const llmStats = await read_cache_1.readCache.get('dashboard:llm:kim_nghia', read_cache_1.DASHBOARD_READ_TTL_MS, async () => {
            const methodId = 'kim_nghia';
            const startUtc = new Date();
            startUtc.setUTCHours(0, 0, 0, 0);
            const decisionsToday = await prisma_1.prisma.tradeDecision.findMany({
                where: { method_id: methodId, timestamp: { gte: startUtc } },
                select: { reason: true, decision: true, timestamp: true },
            });
            let skippedCallCount = 0;
            let noTradeCount = 0;
            let invalidJsonCount = 0;
            let llmEngagedCount = 0;
            let lastEngaged = null;
            for (const d of decisionsToday) {
                const r = d.reason || '';
                if (isSignalGateOnlyReason(r) || r.startsWith('Pre-LLM')) {
                    skippedCallCount += 1;
                    continue;
                }
                llmEngagedCount += 1;
                if (!lastEngaged || d.timestamp > lastEngaged)
                    lastEngaged = d.timestamp;
                if (d.decision === 'no_trade')
                    noTradeCount += 1;
                if (r.includes('LLM: invalid JSON') || r.includes('invalid or unparseable')) {
                    invalidJsonCount += 1;
                }
            }
            const lastLlmDecision = await prisma_1.prisma.tradeDecision.findFirst({
                where: {
                    method_id: methodId,
                    NOT: [
                        { reason: { startsWith: 'Signal gate:' } },
                        { reason: { startsWith: 'Signal gate blocked:' } },
                        { reason: { startsWith: 'Pre-LLM' } },
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
            const recentAnalysis = await prisma_1.prisma.analysisHistory.findFirst({
                where: { coin: 'BTC', method_id: methodId },
                orderBy: { timestamp: 'desc' },
                select: { raw_answer: true },
            });
            const requests = await prisma_1.prisma.testnetTradeEvent.findMany({
                where: { event_type: 'llm_provider_request', timestamp: { gte: startUtc } },
                orderBy: { timestamp: 'desc' }, select: { timestamp: true, event_data: true },
            });
            let actualModel = null;
            try {
                actualModel = requests[0]?.event_data ? JSON.parse(requests[0].event_data).model : null;
            }
            catch { /* metadata only */ }
            const modelName = actualModel ?? ((0, openrouter_models_1.isOpenRouterPrimaryProvider)() ? (0, openrouter_models_1.getOpenRouterDispatchModel)() : (0, groq_models_1.getGroqPrimaryModel)());
            const promptVersion = process.env.PROMPT_VERSION || 'v3';
            let responseStatus = 'none';
            if (llmEngagedCount > 0) {
                responseStatus = invalidJsonCount > 0 ? 'degraded' : 'success';
            }
            else if (lastLlmDecision?.reason?.includes('Execution blocked:')) {
                responseStatus = 'execution_blocked';
            }
            else if (lastLlmDecision?.decision === 'trade') {
                responseStatus = 'trade';
            }
            else if (lastLlmDecision) {
                responseStatus = 'no_trade';
            }
            else if (recentAnalysis?.raw_answer) {
                responseStatus = 'success';
            }
            return {
                callsToday: requests.length,
                callsSource: 'provider_request_events',
                decisionCountToday: llmEngagedCount,
                lastDecisionAt: lastCallTs ? lastCallTs.toISOString() : null,
                lastCall: requests[0]?.timestamp.toISOString() ?? null,
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
    }
    catch (error) {
        console.error('[Dashboard] Error fetching LLM stats:', error.message);
        res.status(500).json({ ok: false, error: 'Failed to fetch LLM stats' });
    }
});
/**
 * GET /api/dashboard/memory
 * Get memory-based insights
 */
router.get('/memory', async (_req, res) => {
    try {
        const memory = await read_cache_1.readCache.get('dashboard:memory', read_cache_1.DASHBOARD_READ_TTL_MS, async () => {
            // Get similar setups from recent trade decisions
            const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const recentDecisions = await prisma_1.prisma.tradeDecision.findMany({
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
            const playbookStats = await prisma_1.prisma.playbookStats.findMany({
                where: { total_trades: { gt: 0 } },
            });
            const playbookWinrate = {};
            playbookStats.forEach((stat) => {
                playbookWinrate[stat.playbook_key] = stat.win_rate * 100;
            });
            // Get failure patterns from trade reflections
            const reflections = await prisma_1.prisma.tradeReflection.findMany({
                take: 3,
                orderBy: { timestamp: 'desc' },
            });
            const failurePatterns = reflections
                .map((r) => r.what_went_wrong)
                .filter((w) => w !== null && w !== undefined)
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
    }
    catch (error) {
        console.error('[Dashboard] Error fetching memory insights:', error.message);
        res.status(500).json({ ok: false, error: 'Failed to fetch memory insights' });
    }
});
/**
 * GET /api/dashboard/no-trade-reasons
 * Get aggregated no-trade reasons
 */
router.get('/no-trade-reasons', async (_req, res) => {
    try {
        const noTradeReasons = await read_cache_1.readCache.get('dashboard:no-trade-reasons', read_cache_1.DASHBOARD_READ_TTL_MS, async () => {
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
            // Recent no_trade decisions only (last 24h) — avoid stale historical aggregates
            const recentDecisions = await prisma_1.prisma.tradeDecision.findMany({
                where: {
                    decision: 'no_trade',
                    timestamp: { gte: since },
                },
                orderBy: { timestamp: 'desc' },
                take: 100,
            });
            // Aggregate by reason
            const reasonCounts = {};
            recentDecisions.forEach((decision) => {
                const reason = decision.reason || 'unknown';
                reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
            });
            // Map to frontend format
            return Object.entries(reasonCounts)
                .map(([reason, count]) => {
                let variant = 'default';
                const rl = reason.toLowerCase();
                if (rl.includes('loss') || rl.includes('limit') || rl.includes('risk'))
                    variant = 'danger';
                else if (rl.includes('insufficient') || rl.includes('spread') || rl.includes('candle'))
                    variant = 'warning';
                return { reason, count, variant };
            })
                .sort((a, b) => b.count - a.count);
        });
        res.json({
            ok: true,
            data: noTradeReasons,
        });
    }
    catch (error) {
        console.error('[Dashboard] Error fetching no-trade reasons:', error.message);
        res.status(500).json({ ok: false, error: 'Failed to fetch no-trade reasons' });
    }
});
/**
 * GET /api/dashboard/events
 * Get recent system events
 */
router.get('/events', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(String(req.query.page || 1), 10) || 1);
        const pageSize = Math.min(Math.max(1, parseInt(String(req.query.pageSize || req.query.limit || 8), 10) || 8), 50);
        const moduleFilter = typeof req.query.module === 'string' ? req.query.module.toLowerCase() : '';
        const poolSize = 80;
        const payload = await read_cache_1.readCache.get(`dashboard:events:${page}:${pageSize}:${moduleFilter}`, read_cache_1.DASHBOARD_EVENTS_TTL_MS, async () => {
            const [tradeEvents, decisions] = await Promise.all([
                prisma_1.prisma.testnetTradeEvent.findMany({
                    orderBy: { timestamp: 'desc' },
                    take: poolSize,
                }),
                prisma_1.prisma.tradeDecision.findMany({
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
                let parsed = null;
                if (typeof rawDetails === 'string' && rawDetails.startsWith('{')) {
                    try {
                        parsed = JSON.parse(rawDetails);
                    }
                    catch {
                        parsed = null;
                    }
                }
                const isExecBlocked = event.event_type === 'execution_blocked';
                const rawDetailsStr = typeof rawDetails === 'string'
                    ? rawDetails.substring(0, 500)
                    : rawDetails != null
                        ? JSON.stringify(rawDetails).substring(0, 500)
                        : '';
                const mappedProtect = mapProtectiveTradeEvent(event.event_type, parsed, rawDetailsStr);
                let message = mappedProtect?.message ?? event.event_type;
                let details = mappedProtect?.details ?? rawDetailsStr;
                let module = mappedProtect?.module ?? 'Trading';
                let severity = mappedProtect?.severity ??
                    (event.event_type.toLowerCase().includes('error') ? 'error' : 'info');
                if (isExecBlocked) {
                    message = 'LLM TRADE — không vào lệnh';
                    module = 'Execution';
                    severity = 'warning';
                    const blockReason = parsed?.reason ||
                        (typeof parsed === 'object' && parsed ? details : 'Execution blocked');
                    const sym = parsed?.symbol || '';
                    const tf = parsed?.timeframe || '';
                    const phase = parsed?.phase === 'pre_execution'
                        ? '(sau Groq, trước Binance)'
                        : parsed?.phase === 'binance_execution'
                            ? '(sau Groq, lúc gửi lệnh)'
                            : '';
                    const levels = formatLevelsBlock({
                        entry_price: parsed?.entry,
                        stop_loss: parsed?.stop_loss,
                        take_profit: parsed?.take_profit,
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
            let merged = [...fromEvents, ...fromDecisions].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
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
        });
        res.json({
            ok: true,
            data: payload.data,
            pagination: payload.pagination,
        });
    }
    catch (error) {
        console.error('[Dashboard] Error fetching events:', error.message);
        res.json({ ok: true, data: [] });
    }
});
/**
 * GET /api/account/balance
 * Get account balance information
 */
router.get('/balance', async (req, res) => {
    try {
        const { symbol = 'BTC', method = 'kim_nghia' } = req.query;
        const sym = String(symbol);
        const meth = String(method);
        const balance = await read_cache_1.readCache.get(`account:balance:${sym}:${meth}`, read_cache_1.ACCOUNT_BALANCE_TTL_MS, async () => {
            const summary = await (0, account_summary_service_1.getAccountBalanceSummary)(sym, meth, false);
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
            const { symbol: _s, methodId: _m, openUnrealized: _u, exposureUsd: _e, maxExposureUsd: _x, ...apiBalance } = summary;
            return apiBalance;
        });
        res.json({
            ok: true,
            success: true,
            data: balance,
        });
    }
    catch (error) {
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
router.get('/positions', async (req, res) => {
    try {
        const { symbol, method } = req.query;
        const sym = symbol ? String(symbol).toUpperCase() : undefined;
        const methodId = method ? String(method) : 'kim_nghia';
        const positions = await (0, account_summary_service_1.getLiveOpenPositionLines)(sym, methodId);
        const formattedPositions = positions.map((pos) => {
            const pnlPercentage = (0, position_mark_1.calculatePnlPercent)(pos.side, pos.entry, pos.mark);
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
    }
    catch (error) {
        console.error('[Dashboard] Error fetching positions:', error.message);
        res.json({ ok: true, data: [] });
    }
});
/**
 * GET /api/account/orders
 * Get active orders
 */
router.get('/orders', async (req, res) => {
    try {
        const { symbol, method } = req.query;
        const sym = symbol ? String(symbol).toUpperCase() : undefined;
        const methodId = method ? String(method) : 'kim_nghia';
        const orders = await (0, account_summary_service_1.getLivePendingOrderLines)(sym, methodId);
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
    }
    catch (error) {
        console.error('[Dashboard] Error fetching orders:', error.message);
        res.status(500).json({ ok: false, error: 'Failed to fetch orders' });
    }
});
/**
 * GET /api/account/trades
 * Get trade history
 */
router.get('/trades', async (req, res) => {
    try {
        const { limit = 20, symbol, method } = req.query;
        const take = parseInt(limit, 10);
        const sym = symbol ? String(symbol).toUpperCase() : undefined;
        if (process.env.BINANCE_ENABLED === 'true' && sym) {
            try {
                const rounds = await (0, binance_trade_history_service_1.fetchBinanceClosedTradeRounds)(sym, take);
                res.json({ ok: true, data: rounds.map(r => ({ ...r, grossRealizedPnL: r.realizedPnL,
                        realizedPnL: r.netPnl ?? r.realizedPnL - r.fee - (r.fundingFee ?? 0), pnlBasis: 'net_after_fees_and_funding' })) });
                return;
            }
            catch (binanceErr) {
                const msg = binanceErr instanceof Error ? binanceErr.message : String(binanceErr);
                console.warn(`[Dashboard] Binance trades for ${sym} failed, using DB: ${msg}`);
            }
        }
        const positions = await prisma_1.prisma.testnetPosition.findMany({
            where: {
                status: { in: ['closed', 'CLOSED'] },
                position_id: { not: testnet_repository_1.PIPELINE_EVENT_POSITION_ID },
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
            .filter(account_performance_service_1.isReportableClosedTrade)
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
    }
    catch (error) {
        console.error('[Dashboard] Error fetching trades:', error.message);
        res.status(500).json({ ok: false, error: 'Failed to fetch trades' });
    }
});
const AI_SCOPES = [
    'today_run',
    'errors',
    'pipeline',
    'llm',
    'compare',
    'freeform',
];
router.get('/telegram-ai/status', (_req, res) => {
    res.json({
        success: true,
        data: {
            enabled: (0, telegram_ai_1.isTelegramAiEnabled)(),
            scopes: AI_SCOPES,
        },
    });
});
router.post('/telegram-ai/query', async (req, res) => {
    if (!(0, telegram_ai_1.isTelegramAiEnabled)()) {
        res.status(403).json({ success: false, error: 'Telegram AI is disabled' });
        return;
    }
    const scope = req.body?.scope || 'today_run';
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
        const result = await (0, telegram_ai_service_1.runTelegramAiQuery)(scope, question?.trim());
        res.json({ success: true, data: result });
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ success: false, error: msg });
    }
});
exports.default = router;
//# sourceMappingURL=dashboard.js.map
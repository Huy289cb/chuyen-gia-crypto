"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatRelativeAgo = formatRelativeAgo;
exports.getSystemHealthSnapshot = getSystemHealthSnapshot;
exports.getLlmStatsTodayIct = getLlmStatsTodayIct;
exports.getLastKimDecision = getLastKimDecision;
exports.getTopNoTradeReasonsIct = getTopNoTradeReasonsIct;
const prisma_1 = require("../lib/prisma");
const app_1 = require("../config/app");
const risk_policy_1 = require("../config/risk-policy");
const v3_schedulers_1 = require("../config/v3-schedulers");
const scheduler_heartbeat_1 = require("../utils/scheduler-heartbeat");
const ict_time_1 = require("../utils/ict-time");
const account_circuit_service_1 = require("./account-circuit.service");
const POS_CRON = '*/1 * * * *';
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
    return Date.now() - last.getTime() < staleAfterMs ? 'running' : 'stale';
}
async function getSystemHealthSnapshot() {
    let databaseStatus = 'healthy';
    try {
        await prisma_1.prisma.$queryRaw `SELECT 1`;
    }
    catch {
        databaseStatus = 'error';
    }
    const workerStatus = await (0, scheduler_heartbeat_1.inferWorkerActivityStatus)();
    let safetyValidation = 'unknown';
    try {
        (0, app_1.validateSafetyRequirements)();
        safetyValidation = 'passed';
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : 'validation error';
        safetyValidation = `failed: ${msg}`;
    }
    const now = new Date();
    const lockedAccounts = await prisma_1.prisma.testnetAccount.count({
        where: {
            OR: [{ cooldown_until: { gt: now } }, { precision_cooldown_until: { gt: now } }],
        },
    });
    const lockStatus = lockedAccounts > 0 ? 'locked' : 'unlocked';
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
    const schedulers = [
        {
            name: 'MarketScan',
            cron: v3_schedulers_1.V3_MARKET_SCAN_CRON,
            status: inferSchedulerStatus(marketLast, 6 * 60_000),
            lastRun: formatRelativeAgo(marketLast),
            lastRunAt: marketLast?.toISOString() ?? null,
        },
        {
            name: 'LLMDispatch',
            cron: v3_schedulers_1.V3_LLM_DISPATCH_CRON,
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
    const timeframes = (0, v3_schedulers_1.getV3WarmupTimeframes)();
    const requiredCandles = (0, v3_schedulers_1.getV3WarmupRequiredCandles)();
    const grouped = await prisma_1.prisma.ohlcvCandle.groupBy({
        by: ['timeframe'],
        where: { coin: 'BTC' },
        _count: { _all: true },
    });
    const countByTf = Object.fromEntries(grouped.map((row) => [row.timeframe, row._count._all]));
    const tfStatus = timeframes.map((tf) => ({
        name: tf,
        loaded: countByTf[tf] ?? 0,
        required: requiredCandles[tf] ?? 100,
    }));
    const isWarmedUp = tfStatus.every((tf) => tf.loaded >= tf.required);
    const policy = (0, risk_policy_1.getRiskPolicy)();
    const account = await prisma_1.prisma.testnetAccount.findFirst({ where: { symbol: 'BTC' } });
    const balanceBase = account?.current_balance || account?.equity || 0;
    const dailyLossCapUsd = balanceBase * (policy.dailyLossLimitPercent / 100);
    let dailyLossCurrent = 0;
    let isLocked = false;
    let lockReason = null;
    if (account) {
        const circuit = await (0, account_circuit_service_1.getAccountCircuitStatus)(account.id);
        dailyLossCurrent = circuit.dailyLossUsd;
        const lossCooldown = account.cooldown_until && account.cooldown_until > now;
        const precisionCooldown = account.precision_cooldown_until && account.precision_cooldown_until > now;
        isLocked = Boolean(lossCooldown || precisionCooldown || !circuit.allowed);
        if (!circuit.allowed)
            lockReason = circuit.reason;
        else if (lossCooldown)
            lockReason = 'Loss cooldown';
        else if (precisionCooldown)
            lockReason = 'Precision cooldown';
    }
    const events = await prisma_1.prisma.testnetTradeEvent.findMany({
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
async function getLlmStatsTodayIct() {
    const { dayStart } = (0, ict_time_1.getDayBoundsICT)();
    const decisions = await prisma_1.prisma.tradeDecision.findMany({
        where: { timestamp: { gte: dayStart }, method_id: 'kim_nghia' },
        select: { decision: true },
    });
    const trades = decisions.filter((d) => d.decision === 'trade').length;
    return { total: decisions.length, trades, noTrades: decisions.length - trades };
}
async function getLastKimDecision() {
    const row = await prisma_1.prisma.tradeDecision.findFirst({
        where: { method_id: 'kim_nghia' },
        orderBy: { timestamp: 'desc' },
        select: { decision: true, reason: true, timestamp: true },
    });
    return row ?? null;
}
async function getTopNoTradeReasonsIct(limit = 3) {
    const { dayStart } = (0, ict_time_1.getDayBoundsICT)();
    const rows = await prisma_1.prisma.tradeDecision.findMany({
        where: {
            timestamp: { gte: dayStart },
            decision: 'no_trade',
            method_id: 'kim_nghia',
        },
        select: { reason: true },
    });
    const counts = new Map();
    for (const r of rows) {
        const key = (r.reason || 'unknown').slice(0, 80);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}
//# sourceMappingURL=system-health.service.js.map
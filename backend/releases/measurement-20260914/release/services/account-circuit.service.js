"use strict";
/**
 * Phase 0 account circuits: daily loss %, peak drawdown %, expectancy kill.
 * Soft-block new entries (no flatten). Peak equity from starting_balance + snapshots.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calcDailyLossPercent = calcDailyLossPercent;
exports.calcDrawdownPercent = calcDrawdownPercent;
exports.resolvePeakEquity = resolvePeakEquity;
exports.getAccountCircuitStatus = getAccountCircuitStatus;
exports.applyExpectancyKillCooldownIfNeeded = applyExpectancyKillCooldownIfNeeded;
const prisma_1 = require("../lib/prisma");
const risk_policy_1 = require("../config/risk-policy");
const ict_time_1 = require("../utils/ict-time");
const expectancy_rollup_service_1 = require("./expectancy-rollup.service");
/** Loss from day-start equity as percent of start (0 if flat/up). */
function calcDailyLossPercent(startEquity, currentEquity) {
    if (!(startEquity > 0) || currentEquity >= startEquity)
        return 0;
    return ((startEquity - currentEquity) / startEquity) * 100;
}
/** Drawdown from peak as percent of peak (0 if at/above peak). */
function calcDrawdownPercent(peakEquity, currentEquity) {
    if (!(peakEquity > 0) || currentEquity >= peakEquity)
        return 0;
    return ((peakEquity - currentEquity) / peakEquity) * 100;
}
async function resolvePeakEquity(accountId, currentEquity, startingBalance) {
    const resolved = await resolveCircuitPeakEquity(accountId, currentEquity, startingBalance);
    return resolved.peakEquity;
}
async function resolveCircuitPeakEquity(accountId, currentEquity, startingBalance) {
    const policy = (0, risk_policy_1.getRiskPolicy)();
    if (policy.circuitPeakEquityOverride != null) {
        // The override is an epoch seed, not a permanent ceiling. Once live equity
        // makes a higher peak, retain it from strategy-epoch snapshots so drawdown
        // cannot silently fall back to the old manual value after equity declines.
        const agg = policy.circuitExpectancySince
            ? await prisma_1.prisma.testnetAccountSnapshot.aggregate({
                where: {
                    account_id: accountId,
                    timestamp: { gte: policy.circuitExpectancySince },
                },
                _max: { equity: true },
            })
            : null;
        const snapshotPeak = agg?._max.equity ?? 0;
        const peakEquity = Math.max(policy.circuitPeakEquityOverride, currentEquity || 0, snapshotPeak);
        return {
            peakEquity,
            source: peakEquity > policy.circuitPeakEquityOverride
                ? 'override_ratcheted'
                : 'override',
        };
    }
    if (policy.circuitExpectancySince) {
        const [baseline, agg] = await Promise.all([
            prisma_1.prisma.testnetAccountSnapshot.findFirst({
                where: {
                    account_id: accountId,
                    timestamp: { lt: policy.circuitExpectancySince },
                },
                orderBy: { timestamp: 'desc' },
                select: { equity: true },
            }),
            prisma_1.prisma.testnetAccountSnapshot.aggregate({
                where: {
                    account_id: accountId,
                    timestamp: { gte: policy.circuitExpectancySince },
                },
                _max: { equity: true },
            }),
        ]);
        return {
            peakEquity: Math.max(baseline?.equity ?? startingBalance ?? 0, currentEquity || 0, agg._max.equity ?? 0),
            source: 'strategy_epoch_snapshots',
        };
    }
    const agg = await prisma_1.prisma.testnetAccountSnapshot.aggregate({
        where: { account_id: accountId },
        _max: { equity: true },
    });
    const snapPeak = agg._max.equity ?? 0;
    return {
        peakEquity: Math.max(startingBalance || 0, currentEquity || 0, snapPeak || 0),
        source: 'full_history_snapshots',
    };
}
async function getAccountCircuitStatus(accountId) {
    const policy = (0, risk_policy_1.getRiskPolicy)();
    const scope = {
        scope: 'strategy_epoch',
        epochStart: policy.circuitExpectancySince,
        expectancySince: policy.circuitExpectancySince,
    };
    const account = await prisma_1.prisma.testnetAccount.findUnique({ where: { id: accountId } });
    if (!account) {
        return {
            ...scope,
            peakEquitySource: policy.circuitPeakEquityOverride != null ? 'override' :
                policy.circuitExpectancySince ? 'strategy_epoch_snapshots' : 'full_history_snapshots',
            allowed: false,
            reason: 'Testnet account not found',
            dailyLossUsd: 0,
            dailyLossPercent: 0,
            dailyLossLimitPercent: policy.dailyLossLimitPercent,
            peakEquity: 0,
            drawdownPercent: 0,
            maxDrawdownPercent: policy.maxDrawdownPercent,
            expectancy: { n: 0, sumR: 0, avgR: 0, profitFactor: null },
        };
    }
    const equity = account.equity ?? account.current_balance ?? 0;
    const { dayStart } = (0, ict_time_1.getDayBoundsICT)();
    const baseline = await prisma_1.prisma.testnetAccountSnapshot.findFirst({
        where: { account_id: accountId, timestamp: { lt: dayStart } },
        orderBy: { timestamp: 'desc' },
    });
    const startEquity = baseline?.equity ?? equity;
    const dailyLossUsd = equity < startEquity ? startEquity - equity : 0;
    const dailyLossPercent = calcDailyLossPercent(startEquity, equity);
    const peak = await resolveCircuitPeakEquity(accountId, equity, account.starting_balance);
    const peakEquity = peak.peakEquity;
    const drawdownPercent = calcDrawdownPercent(peakEquity, equity);
    if (drawdownPercent > (account.max_drawdown ?? 0)) {
        await prisma_1.prisma.testnetAccount.update({
            where: { id: accountId },
            data: { max_drawdown: drawdownPercent },
        });
    }
    const outcomes = await prisma_1.prisma.tradeOutcome.findMany({
        where: policy.circuitExpectancySince
            ? { timestamp: { gte: policy.circuitExpectancySince } }
            : undefined,
        orderBy: { timestamp: 'desc' },
        take: policy.circuitExpectancyWindow,
        select: { realized_rr: true, realized_pnl: true },
    });
    const expectancy = (0, expectancy_rollup_service_1.rollupExpectancyFromOutcomes)(outcomes);
    if (policy.circuitDailyLossEnabled && dailyLossPercent >= policy.dailyLossLimitPercent) {
        return {
            ...scope,
            peakEquitySource: peak.source,
            allowed: false,
            reason: `Daily loss circuit ${dailyLossPercent.toFixed(2)}% >= ${policy.dailyLossLimitPercent}%`,
            startEquity,
            dailyLossUsd,
            dailyLossPercent,
            dailyLossLimitPercent: policy.dailyLossLimitPercent,
            peakEquity,
            drawdownPercent,
            maxDrawdownPercent: policy.maxDrawdownPercent,
            expectancy,
        };
    }
    if (policy.circuitDrawdownEnabled && drawdownPercent >= policy.maxDrawdownPercent) {
        return {
            ...scope,
            peakEquitySource: peak.source,
            allowed: false,
            reason: `Drawdown circuit ${drawdownPercent.toFixed(2)}% >= ${policy.maxDrawdownPercent}% from peak`,
            startEquity,
            dailyLossUsd,
            dailyLossPercent,
            dailyLossLimitPercent: policy.dailyLossLimitPercent,
            peakEquity,
            drawdownPercent,
            maxDrawdownPercent: policy.maxDrawdownPercent,
            expectancy,
        };
    }
    if (policy.circuitExpectancyKillEnabled &&
        expectancy.n >= policy.circuitExpectancyWindow &&
        expectancy.sumR <= policy.circuitExpectancyMinSumR) {
        return {
            ...scope,
            peakEquitySource: peak.source,
            allowed: false,
            reason: `Expectancy kill: last ${expectancy.n} closes sumR=${expectancy.sumR.toFixed(2)} ` +
                `<= ${policy.circuitExpectancyMinSumR} (avgR=${expectancy.avgR.toFixed(3)})`,
            startEquity,
            dailyLossUsd,
            dailyLossPercent,
            dailyLossLimitPercent: policy.dailyLossLimitPercent,
            peakEquity,
            drawdownPercent,
            maxDrawdownPercent: policy.maxDrawdownPercent,
            expectancy,
        };
    }
    return {
        ...scope,
        peakEquitySource: peak.source,
        allowed: true,
        reason: 'circuits clear',
        startEquity,
        dailyLossUsd,
        dailyLossPercent,
        dailyLossLimitPercent: policy.dailyLossLimitPercent,
        peakEquity,
        drawdownPercent,
        maxDrawdownPercent: policy.maxDrawdownPercent,
        expectancy,
    };
}
/** Sticky pause when expectancy kill trips (idempotent if longer cooldown already set). */
async function applyExpectancyKillCooldownIfNeeded(accountId, status) {
    const policy = (0, risk_policy_1.getRiskPolicy)();
    if (status.allowed || !status.reason.startsWith('Expectancy kill:'))
        return;
    const hours = policy.circuitExpectancyCooldownHours;
    if (!(hours > 0))
        return;
    const until = new Date(Date.now() + hours * 3_600_000);
    const account = await prisma_1.prisma.testnetAccount.findUnique({
        where: { id: accountId },
        select: { cooldown_until: true },
    });
    if (account?.cooldown_until && account.cooldown_until > until)
        return;
    await prisma_1.prisma.testnetAccount.update({
        where: { id: accountId },
        data: { cooldown_until: until },
    });
    console.log(`[AccountCircuit] expectancy kill → cooldown until ${until.toISOString()} (${hours}h)`);
}
//# sourceMappingURL=account-circuit.service.js.map
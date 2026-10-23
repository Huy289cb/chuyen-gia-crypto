"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isReportableClosedTrade = isReportableClosedTrade;
exports.calculateClosedTradeMetrics = calculateClosedTradeMetrics;
exports.calculateFullHistoryWalletMetrics = calculateFullHistoryWalletMetrics;
exports.getFullHistoryWalletMetrics = getFullHistoryWalletMetrics;
const bookkeeping_close_1 = require("../utils/bookkeeping-close");
const PNL_EPSILON = 0.01;
function finiteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
/**
 * Reconciliation labels are not sufficient to identify bookkeeping rows: older
 * production closes can carry those labels while still containing verified
 * Binance PnL. Keep real PnL and only suppress zero-PnL internal/synthetic rows.
 */
function isReportableClosedTrade(position) {
    if (position.position_id === 'pipeline_v3_kim_nghia')
        return false;
    if (String(position.side ?? '').toUpperCase() === 'NONE')
        return false;
    const pnl = finiteNumber(position.realized_pnl);
    if ((0, bookkeeping_close_1.isInternalCloseReason)(position.close_reason) && Math.abs(pnl) < PNL_EPSILON) {
        return false;
    }
    return true;
}
function calculateClosedTradeMetrics(rows) {
    const positions = rows.filter(isReportableClosedTrade);
    let wins = 0;
    let losses = 0;
    let breakeven = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let positionPnl = 0;
    let storedFees = 0;
    let sumR = 0;
    for (const position of positions) {
        const pnl = finiteNumber(position.realized_pnl);
        positionPnl += pnl;
        sumR += finiteNumber(position.r_multiple);
        storedFees +=
            finiteNumber(position.entry_fee) +
                finiteNumber(position.exit_fee) +
                finiteNumber(position.funding_fee);
        if (pnl > PNL_EPSILON) {
            wins += 1;
            grossProfit += pnl;
        }
        else if (pnl < -PNL_EPSILON) {
            losses += 1;
            grossLoss += Math.abs(pnl);
        }
        else {
            breakeven += 1;
        }
    }
    const decidedTrades = wins + losses;
    return {
        totalTrades: positions.length,
        wins,
        losses,
        breakeven,
        winRate: decidedTrades > 0 ? (wins / decidedTrades) * 100 : 0,
        winRateAllClosed: positions.length > 0 ? (wins / positions.length) * 100 : 0,
        grossProfit,
        grossLoss,
        positionPnl,
        storedFees,
        positionPnlAfterStoredFees: positionPnl - storedFees,
        avgWin: wins > 0 ? grossProfit / wins : 0,
        avgLoss: losses > 0 ? grossLoss / losses : 0,
        profitFactor: losses > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0,
        avgRMultiple: positions.length > 0 ? sumR / positions.length : 0,
    };
}
function calculateFullHistoryWalletMetrics(account, snapshots) {
    const ordered = [...snapshots].sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
    const firstSnapshot = ordered[0] ?? null;
    const lastSnapshot = ordered[ordered.length - 1] ?? null;
    const accountBaseline = finiteNumber(account.starting_balance);
    const fallbackBaseline = firstSnapshot
        ? finiteNumber(firstSnapshot.balance, finiteNumber(firstSnapshot.equity))
        : finiteNumber(account.current_balance);
    const baselineBalance = accountBaseline > 0 ? accountBaseline : fallbackBaseline;
    const currentBalance = finiteNumber(account.current_balance, baselineBalance);
    const currentEquity = finiteNumber(account.equity, currentBalance);
    const points = [];
    if (baselineBalance > 0)
        points.push({ equity: baselineBalance, timestamp: null });
    for (const snapshot of ordered) {
        const equity = finiteNumber(snapshot.equity);
        if (equity >= 0)
            points.push({ equity, timestamp: snapshot.timestamp });
    }
    points.push({ equity: currentEquity, timestamp: null });
    let runningPeak = points[0]?.equity ?? currentEquity;
    let runningPeakAt = points[0]?.timestamp ?? null;
    let peakEquity = runningPeak;
    let peakEquityAt = runningPeakAt;
    let maxDrawdownPercent = 0;
    let maxDrawdownAt = null;
    for (const point of points) {
        if (point.equity > runningPeak) {
            runningPeak = point.equity;
            runningPeakAt = point.timestamp;
        }
        if (point.equity > peakEquity) {
            peakEquity = point.equity;
            peakEquityAt = point.timestamp;
        }
        const drawdown = runningPeak > 0 && point.equity < runningPeak
            ? ((runningPeak - point.equity) / runningPeak) * 100
            : 0;
        if (drawdown > maxDrawdownPercent) {
            maxDrawdownPercent = drawdown;
            maxDrawdownAt = point.timestamp;
        }
    }
    const walletPnl = currentBalance - baselineBalance;
    return {
        scope: 'full_history',
        baselineBalance,
        currentBalance,
        currentEquity,
        walletPnl,
        walletReturnPercent: baselineBalance > 0 ? (walletPnl / baselineBalance) * 100 : 0,
        peakEquity,
        peakEquityAt,
        currentDrawdownPercent: peakEquity > 0 && currentEquity < peakEquity
            ? ((peakEquity - currentEquity) / peakEquity) * 100
            : 0,
        maxDrawdownPercent,
        maxDrawdownAt,
        firstSnapshotAt: firstSnapshot?.timestamp ?? null,
        lastSnapshotAt: lastSnapshot?.timestamp ?? null,
        snapshotCount: ordered.length,
    };
}
async function getFullHistoryWalletMetrics(prismaClient, account) {
    const snapshots = await prismaClient.testnetAccountSnapshot.findMany({
        where: { account_id: account.id },
        orderBy: { timestamp: 'asc' },
        select: { balance: true, equity: true, timestamp: true },
    });
    return calculateFullHistoryWalletMetrics(account, snapshots);
}
//# sourceMappingURL=account-performance.service.js.map
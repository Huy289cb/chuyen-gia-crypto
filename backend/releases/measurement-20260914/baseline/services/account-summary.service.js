"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PNL_DB_GAP_TRUST_USD = void 0;
exports.getAccountBalanceSummary = getAccountBalanceSummary;
exports.getTodayTradeStatsIct = getTodayTradeStatsIct;
exports.getOpenPositionLines = getOpenPositionLines;
exports.getBinanceOpenPositionLines = getBinanceOpenPositionLines;
exports.getBinancePendingOrderLines = getBinancePendingOrderLines;
exports.getLiveOpenPositionLines = getLiveOpenPositionLines;
exports.getLivePendingOrderLines = getLivePendingOrderLines;
exports.enrichPositionsWithBinanceSlTp = enrichPositionsWithBinanceSlTp;
exports.getPendingOrderLines = getPendingOrderLines;
exports.getDefaultTradingScope = getDefaultTradingScope;
const prisma_1 = require("../lib/prisma");
const testnet_repository_1 = require("../repositories/testnet.repository");
const ict_time_1 = require("../utils/ict-time");
const risk_policy_1 = require("../config/risk-policy");
const binance_exposure_service_1 = require("./binance-exposure.service");
const trading_1 = require("./binance/trading");
const position_mark_1 = require("./position-mark");
const binance_income_service_1 = require("./binance-income.service");
const binance_trade_history_service_1 = require("./binance-trade-history.service");
const binance_balance_sync_service_1 = require("./binance-balance-sync.service");
/** Max |wallet − Σ position PnL| before DB position stats are hidden in UI. */
exports.PNL_DB_GAP_TRUST_USD = 0.01;
async function getAccountBalanceSummary(symbol, methodId, useIct = true, refreshFromBinance = false) {
    const empty = {
        isInitialized: false,
        symbol,
        methodId,
        totalBalance: 0,
        availableBalance: 0,
        equity: 0,
        usedMargin: 0,
        freeMargin: 0,
        dailyPnL: 0,
        weeklyPnL: 0,
        openUnrealized: 0,
        exposureUsd: 0,
        maxExposureUsd: (0, risk_policy_1.getRiskPolicy)().maxTotalExposureUsd,
        walletPnl: 0,
        binanceRealizedPnl: 0,
        dbPositionPnlSum: 0,
        dbPositionPnlGap: 0,
        positionTradingPnlGap: 0,
        walletIncomeGap: 0,
        dbPositionPnlTrusted: true,
        pnlSource: 'wallet',
        totalFees: 0,
        fundingFees: 0,
        startingBalance: 0,
    };
    const account = await (0, testnet_repository_1.getTestnetAccount)(symbol, methodId);
    if (!account)
        return empty;
    const binanceEnabled = process.env.BINANCE_ENABLED === 'true';
    let liveAccount = account;
    if (binanceEnabled && refreshFromBinance) {
        try {
            await (0, binance_balance_sync_service_1.syncTestnetAccountFromBinance)(account.id);
            const refreshed = await (0, testnet_repository_1.getTestnetAccount)(symbol, methodId);
            if (refreshed)
                liveAccount = refreshed;
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`[AccountSummary] Binance balance refresh failed: ${msg}`);
        }
    }
    const dayStart = useIct
        ? (0, ict_time_1.getDayBoundsICT)().dayStart
        : (() => {
            const d = new Date();
            d.setUTCHours(0, 0, 0, 0);
            return d;
        })();
    const weekStart = useIct
        ? (0, ict_time_1.getDayBoundsICT)().weekStart
        : (() => {
            const d = new Date();
            d.setUTCDate(d.getUTCDate() - 7);
            d.setUTCHours(0, 0, 0, 0);
            return d;
        })();
    const [baselineDay, baselineWeek, marginAgg, realizedTodayAgg, realizedWeekAgg, unrealizedOpenAgg, dbClosedSum, openPositions, pendingOrders] = await Promise.all([
        prisma_1.prisma.testnetAccountSnapshot.findFirst({
            where: { account_id: account.id, timestamp: { lt: dayStart } },
            orderBy: { timestamp: 'desc' },
        }),
        prisma_1.prisma.testnetAccountSnapshot.findFirst({
            where: { account_id: account.id, timestamp: { lt: weekStart } },
            orderBy: { timestamp: 'desc' },
        }),
        prisma_1.prisma.testnetPosition.aggregate({
            where: { account_id: account.id, status: { in: ['open', 'OPEN'] } },
            _sum: { risk_usd: true },
        }),
        prisma_1.prisma.testnetPosition.aggregate({
            where: {
                account_id: account.id,
                status: { in: ['closed', 'CLOSED'] },
                close_time: { gte: dayStart },
            },
            _sum: { realized_pnl: true },
        }),
        prisma_1.prisma.testnetPosition.aggregate({
            where: {
                account_id: account.id,
                status: { in: ['closed', 'CLOSED'] },
                close_time: { gte: weekStart },
            },
            _sum: { realized_pnl: true },
        }),
        prisma_1.prisma.testnetPosition.aggregate({
            where: { account_id: account.id, status: { in: ['open', 'OPEN'] } },
            _sum: { unrealized_pnl: true },
        }),
        prisma_1.prisma.testnetPosition.aggregate({
            where: {
                account_id: account.id,
                status: { in: ['closed', 'CLOSED'] },
                position_id: { not: 'pipeline_v3_kim_nghia' },
            },
            _sum: { realized_pnl: true },
        }),
        (0, testnet_repository_1.getTestnetPositions)({ symbol, status: 'open', methodId }),
        (0, testnet_repository_1.getTestnetPendingOrders)({ symbol, status: 'pending', methodId }),
    ]);
    const openUnrealizedDb = unrealizedOpenAgg._sum.unrealized_pnl ?? 0;
    const realizedToday = realizedTodayAgg._sum.realized_pnl ?? 0;
    const realizedWeek = realizedWeekAgg._sum.realized_pnl ?? 0;
    const startDayEquity = baselineDay?.equity ?? liveAccount.equity ?? 0;
    const startWeekEquity = baselineWeek?.equity ?? liveAccount.equity ?? 0;
    const equity = liveAccount.equity ?? liveAccount.current_balance ?? 0;
    let openUnrealized = openUnrealizedDb;
    if (binanceEnabled) {
        try {
            const liveLines = await getBinanceOpenPositionLines(symbol);
            if (liveLines.length > 0) {
                openUnrealized = liveLines.reduce((s, p) => s + p.unrealizedPnl, 0);
            }
            else {
                openUnrealized = liveAccount.unrealized_pnl ?? 0;
            }
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`[AccountSummary] Binance open unrealized failed: ${msg}`);
            openUnrealized = liveAccount.unrealized_pnl ?? openUnrealizedDb;
        }
    }
    const dbPositionPnlSum = dbClosedSum._sum.realized_pnl ?? 0;
    const startingBalance = liveAccount.starting_balance || 0;
    const totalBalance = liveAccount.current_balance || 0;
    const walletPnl = totalBalance - startingBalance;
    const dbPositionPnlGap = walletPnl - dbPositionPnlSum;
    const canonicalNetPnl = liveAccount.realized_pnl ?? 0;
    const totalFees = liveAccount.accumulated_trading_fees ?? 0;
    const fundingFees = liveAccount.accumulated_funding_fee ?? 0;
    // Keep the public gross-PnL field compatible while comparing NET to NET.
    const binanceRealizedPnl = canonicalNetPnl + totalFees + fundingFees;
    const positionTradingPnlGap = canonicalNetPnl - dbPositionPnlSum;
    const approximateNetTradingPnl = canonicalNetPnl;
    const walletIncomeGap = walletPnl - approximateNetTradingPnl;
    const trustGap = Math.abs(binanceRealizedPnl) > 0.01 || Math.abs(dbPositionPnlSum) > 0.01
        ? positionTradingPnlGap
        : dbPositionPnlGap;
    const dbPositionPnlTrusted = Math.abs(trustGap) <= exports.PNL_DB_GAP_TRUST_USD && Math.abs(walletIncomeGap) <= exports.PNL_DB_GAP_TRUST_USD;
    let dailyPnL;
    let weeklyPnL;
    if (binanceEnabled || !dbPositionPnlTrusted) {
        dailyPnL = equity - startDayEquity;
        weeklyPnL = equity - startWeekEquity;
    }
    else {
        dailyPnL =
            realizedToday !== 0 || openUnrealized !== 0 ? realizedToday + openUnrealized : equity - startDayEquity;
        weeklyPnL =
            realizedWeek !== 0 || openUnrealized !== 0 ? realizedWeek + openUnrealized : equity - startWeekEquity;
    }
    const usedMargin = marginAgg._sum.risk_usd || 0;
    const openVol = openPositions.reduce((s, p) => s + Math.abs(Number(p.size_usd) || 0), 0);
    const pendingVol = pendingOrders.reduce((s, o) => s + Math.abs(Number(o.size_usd) || 0), 0);
    return {
        isInitialized: true,
        symbol,
        methodId,
        totalBalance,
        availableBalance: Math.max(0, totalBalance - usedMargin),
        equity,
        usedMargin,
        freeMargin: Math.max(0, equity - usedMargin),
        dailyPnL,
        weeklyPnL,
        openUnrealized,
        exposureUsd: openVol + pendingVol,
        maxExposureUsd: (0, risk_policy_1.getRiskPolicy)().maxTotalExposureUsd,
        walletPnl,
        binanceRealizedPnl,
        dbPositionPnlSum,
        dbPositionPnlGap,
        positionTradingPnlGap,
        walletIncomeGap,
        dbPositionPnlTrusted,
        pnlSource: 'wallet',
        totalFees,
        fundingFees,
        startingBalance,
    };
}
async function getTodayTradeStatsIct(symbol, methodId) {
    const account = await (0, testnet_repository_1.getTestnetAccount)(symbol, methodId);
    if (!account) {
        return {
            closedCount: 0,
            wins: 0,
            losses: 0,
            totalRealizedPnl: 0,
            totalFees: 0,
            fromDbPositions: false,
            source: 'db',
        };
    }
    const { dayStart } = (0, ict_time_1.getDayBoundsICT)();
    if (process.env.BINANCE_ENABLED === 'true') {
        try {
            return await getTodayTradeStatsFromBinance(symbol, dayStart);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`[AccountSummary] Binance today trade stats failed: ${msg}`);
        }
    }
    const closed = await prisma_1.prisma.testnetPosition.findMany({
        where: {
            account_id: account.id,
            status: { in: ['closed', 'CLOSED'] },
            close_time: { gte: dayStart },
        },
        select: { realized_pnl: true, entry_fee: true, exit_fee: true, funding_fee: true },
    });
    let wins = 0;
    let losses = 0;
    let totalRealizedPnl = 0;
    let totalFees = 0;
    for (const p of closed) {
        const pnl = p.realized_pnl ?? 0;
        totalRealizedPnl += pnl;
        totalFees += (p.entry_fee ?? 0) + (p.exit_fee ?? 0) + (p.funding_fee ?? 0);
        if (pnl > 0)
            wins++;
        else if (pnl < 0)
            losses++;
    }
    const balance = await getAccountBalanceSummary(symbol, methodId, true);
    return {
        closedCount: closed.length,
        wins,
        losses,
        totalRealizedPnl,
        totalFees,
        fromDbPositions: balance.dbPositionPnlTrusted,
        source: 'db',
    };
}
async function getTodayTradeStatsFromBinance(symbol, dayStart) {
    const [income, rounds] = await Promise.all([
        (0, binance_income_service_1.fetchBinanceIncomeSummary)({ startTime: dayStart.getTime(), symbol }),
        (0, binance_trade_history_service_1.fetchBinanceClosedTradeRounds)(symbol, 100),
    ]);
    const todayRounds = rounds.filter((r) => new Date(r.closedAt) >= dayStart);
    let wins = 0;
    let losses = 0;
    for (const r of todayRounds) {
        const net = r.netPnl ?? r.realizedPnL - r.fee - (r.fundingFee ?? 0);
        if (net > 0.01)
            wins++;
        else if (net < -0.01)
            losses++;
    }
    return {
        closedCount: todayRounds.length,
        wins,
        losses,
        totalRealizedPnl: income.netTradingPnl,
        totalFees: Math.abs(income.commission),
        fromDbPositions: false,
        source: 'binance',
    };
}
async function getOpenPositionLines(symbol, methodId = 'kim_nghia') {
    const positions = await (0, testnet_repository_1.getTestnetPositions)({
        symbol,
        status: 'open',
        methodId,
    });
    const lines = [];
    for (const pos of positions) {
        const entry = pos.entry_price || 0;
        const mark = await (0, position_mark_1.resolveMarkPrice)(pos.symbol, pos.current_price || entry);
        const uPnL = (0, position_mark_1.calculateUnrealizedPnl)(pos.side, entry, mark, pos.size_qty || 0);
        lines.push({
            positionId: pos.position_id,
            symbol: pos.symbol,
            side: pos.side,
            entry,
            mark,
            unrealizedPnl: uPnL,
            sizeUsd: pos.size_usd || 0,
            sizeQty: Math.abs(pos.size_qty || 0),
            stopLoss: pos.stop_loss ?? null,
            takeProfit: pos.take_profit ?? null,
            entryTime: pos.entry_time ?? null,
        });
    }
    return lines;
}
function pairUsdt(symbol) {
    return `${symbol.toUpperCase().replace(/USDT$/i, '')}USDT`;
}
/** Open positions from Binance positionRisk (source of truth). */
async function getBinanceOpenPositionLines(symbol) {
    const active = await (0, binance_exposure_service_1.fetchActiveBinancePositions)(symbol, { allowUserTradesFallback: false });
    return active.map((p) => {
        const mark = p.markPrice || p.entryPrice;
        const unrealizedPnl = p.unRealizedProfit ??
            (0, position_mark_1.calculateUnrealizedPnl)(p.side, p.entryPrice, mark, p.positionAmt);
        const sizeUsd = p.notional != null && Math.abs(p.notional) > 0
            ? Math.abs(p.notional)
            : p.positionAmt * mark;
        return {
            positionId: `binance-${p.symbol}-${p.side}`,
            symbol: p.symbol,
            side: p.side,
            entry: p.entryPrice,
            mark,
            unrealizedPnl,
            sizeUsd,
            sizeQty: p.positionAmt,
        };
    });
}
/** Pending limit orders from Binance openOrders. */
async function getBinancePendingOrderLines(symbol) {
    const orders = await (0, trading_1.getOpenOrders)(symbol ? pairUsdt(symbol) : null);
    return orders
        .filter((o) => {
        const t = String(o.type ?? '').toUpperCase();
        const st = String(o.status ?? '').toUpperCase();
        return t === 'LIMIT' && (st === 'NEW' || st === 'PARTIALLY_FILLED');
    })
        .map((o) => ({
        orderId: String(o.orderId),
        symbol: String(o.symbol ?? '').replace(/USDT$/i, ''),
        side: String(o.side).toUpperCase() === 'BUY' ? 'long' : 'short',
        entry: Number(o.price) || 0,
        status: String(o.status ?? 'NEW'),
        quantity: Number(o.quantity ?? o.origQty ?? 0) || 0,
        createdAt: o.updateTime
            ? new Date(Number(o.updateTime)).toISOString()
            : new Date().toISOString(),
        reduceOnly: Boolean(o.reduceOnly),
    }));
}
/** Merge local entry_time + SL/TP fallback onto Binance-sourced lines. */
async function enrichPositionsWithLocalBook(lines, methodId) {
    if (lines.length === 0)
        return lines;
    try {
        const dbPositions = await (0, testnet_repository_1.getTestnetPositions)({ status: 'open', methodId });
        return lines.map((line) => {
            const side = line.side.toLowerCase();
            const match = dbPositions.find((p) => p.symbol.toUpperCase().replace(/USDT$/i, '') ===
                line.symbol.toUpperCase().replace(/USDT$/i, '') &&
                p.side.toLowerCase() === side);
            if (!match)
                return line;
            return {
                ...line,
                positionId: match.position_id || line.positionId,
                stopLoss: line.stopLoss ?? match.stop_loss ?? null,
                takeProfit: line.takeProfit ?? match.take_profit ?? null,
                entryTime: match.entry_time ?? line.entryTime ?? null,
            };
        });
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[AccountSummary] Local book enrich failed: ${msg}`);
        return lines;
    }
}
/** Prefer Binance live data when BINANCE_ENABLED. */
async function getLiveOpenPositionLines(symbol, methodId = 'kim_nghia') {
    const scopeSymbol = symbol ?? getDefaultTradingScope().symbol;
    if (process.env.BINANCE_ENABLED === 'true') {
        try {
            const lines = await getBinanceOpenPositionLines(symbol);
            const withSlTp = await enrichPositionsWithBinanceSlTp(lines, scopeSymbol);
            return enrichPositionsWithLocalBook(withSlTp, methodId);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`[AccountSummary] Binance open positions failed: ${msg}`);
        }
    }
    return getOpenPositionLines(symbol, methodId);
}
async function getLivePendingOrderLines(symbol, methodId = 'kim_nghia') {
    if (process.env.BINANCE_ENABLED === 'true') {
        try {
            return await getBinancePendingOrderLines(symbol);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`[AccountSummary] Binance pending orders failed: ${msg}`);
        }
    }
    return getPendingOrderLines(symbol, methodId);
}
function algoTriggerPrice(order) {
    return Number(order.triggerPrice ?? order.stopPrice ?? order.price ?? 0) || 0;
}
/** Attach SL/TP from Binance open algo orders (same source as sàn). */
async function enrichPositionsWithBinanceSlTp(positions, symbol = 'BTC') {
    if (positions.length === 0)
        return positions;
    try {
        const algos = await (0, trading_1.getOpenAlgoOrders)(pairUsdt(symbol));
        let stopLoss = null;
        let takeProfit = null;
        for (const order of algos) {
            const t = String(order.orderType ?? order.type ?? '').toUpperCase();
            if (!t.includes('STOP') && !t.includes('TAKE_PROFIT'))
                continue;
            const px = algoTriggerPrice(order);
            if (px <= 0)
                continue;
            if (t.includes('TAKE_PROFIT'))
                takeProfit = px;
            else if (t.includes('STOP'))
                stopLoss = px;
        }
        return positions.map((p) => ({ ...p, stopLoss, takeProfit }));
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[AccountSummary] Binance SL/TP fetch failed: ${msg}`);
        return positions;
    }
}
async function getPendingOrderLines(symbol, methodId = 'kim_nghia') {
    const orders = await (0, testnet_repository_1.getTestnetPendingOrders)({
        symbol,
        status: 'pending',
        methodId,
    });
    return orders.map((o) => ({
        orderId: o.order_id,
        symbol: o.symbol,
        side: o.side,
        entry: o.entry_price || 0,
        status: o.status,
        quantity: Math.abs(o.size_qty || 0),
        createdAt: o.created_at?.toISOString?.() ?? new Date().toISOString(),
        reduceOnly: false,
    }));
}
function getDefaultTradingScope() {
    const symbols = (process.env.ENABLED_SYMBOLS || 'BTC').split(',')[0]?.trim() || 'BTC';
    return { symbol: symbols.toUpperCase(), methodId: 'kim_nghia' };
}
//# sourceMappingURL=account-summary.service.js.map
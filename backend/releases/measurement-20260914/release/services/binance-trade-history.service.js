"use strict";
/**
 * Closed trade rounds reconstructed from Binance Futures userTrades (source of truth).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchUserTradesByTimeWindows = fetchUserTradesByTimeWindows;
exports.clearBinanceTradeHistoryCacheForTests = clearBinanceTradeHistoryCacheForTests;
exports.aggregateUserTradesToRounds = aggregateUserTradesToRounds;
exports.computeLossStreakFromRounds = computeLossStreakFromRounds;
exports.getBinanceLossStreak = getBinanceLossStreak;
exports.fetchBinanceClosedTradeRounds = fetchBinanceClosedTradeRounds;
const trading_1 = require("./binance/trading");
const exchange_rounds_1 = require("../utils/exchange-rounds");
const binance_income_service_1 = require("./binance-income.service");
function pairSymbol(symbol) {
    const base = symbol.toUpperCase().replace(/USDT$/i, '');
    return `${base}USDT`;
}
// Below Binance BTCUSDT min lot (0.001). Rounds smaller than this come from
// over-closing by a hair / float drift, not real positions — drop them.
const DUST_QTY = 5e-4;
const USER_TRADES_LOOKBACK_MS = 90 * 24 * 3600 * 1000;
// Binance limits Account Trade List queries to a seven-day time range and,
// when no time range is supplied, returns only the latest seven days. Query
// explicit, non-overlapping windows so an idle week does not erase the latest
// loss streak or make the dashboard history look empty.
const USER_TRADES_WINDOW_MS = 7 * 24 * 3600 * 1000;
const USER_TRADES_CACHE_TTL_MS = 60_000;
const roundsCache = new Map();
function userTradeDedupKey(trade) {
    if (trade.tradeId != null)
        return `trade:${String(trade.tradeId)}`;
    return [
        'fill',
        trade.orderId,
        trade.time,
        trade.side,
        trade.price,
        trade.qty,
        trade.realizedPnl,
        trade.commission,
    ].join(':');
}
async function fetchUserTradesByTimeWindows(symbolUsdt, nowMs, lookbackMs = USER_TRADES_LOOKBACK_MS) {
    const cutoffExclusive = nowMs - lookbackMs;
    const unique = new Map();
    let windowEnd = nowMs;
    while (windowEnd > cutoffExclusive) {
        // Both endpoints are inclusive. Subtract one millisecond so the requested
        // span never exceeds Binance's seven-day maximum, then advance backwards
        // without overlapping the adjacent window.
        const windowStart = Math.max(cutoffExclusive + 1, windowEnd - USER_TRADES_WINDOW_MS + 1);
        const fetchCompleteWindow = async (startTime, endTime) => {
            const batch = await (0, trading_1.getUserTrades)(symbolUsdt, { limit: 1000, startTime, endTime });
            if (batch.length >= 1000) {
                // Subdivision avoids losing fills sharing a timestamp. If one ms is saturated,
                // fail explicitly instead of returning an incomplete accounting result.
                if (startTime >= endTime)
                    throw new Error('userTrades saturated within one millisecond');
                const mid = Math.floor((startTime + endTime) / 2);
                await fetchCompleteWindow(startTime, mid);
                await fetchCompleteWindow(mid + 1, endTime);
                return;
            }
            for (const trade of batch) {
                if (trade.time >= startTime && trade.time <= endTime)
                    unique.set(userTradeDedupKey(trade), trade);
            }
        };
        await fetchCompleteWindow(windowStart, windowEnd);
        windowEnd = windowStart - 1;
    }
    return [...unique.values()].sort((a, b) => a.time - b.time);
}
function clearBinanceTradeHistoryCacheForTests() {
    roundsCache.clear();
}
/** Only completed, flat-to-flat rounds belong in the closed history. */
function aggregateUserTradesToRounds(trades, symbol) {
    return (0, exchange_rounds_1.reconstructExchangeRounds)(trades).filter(r => r.quantity >= DUST_QTY).map(r => ({
        id: `binance_${r.closeTime}_${r.side}`,
        symbol: symbol.toUpperCase().replace(/USDT$/i, ''), side: r.side,
        entryPrice: r.entryPrice, closePrice: r.closePrice, quantity: r.quantity,
        fee: r.entryFee + r.exitFee, realizedPnL: r.grossPnl,
        closeReason: 'binance_fills', status: 'closed',
        closedAt: new Date(r.closeTime).toISOString(), openedAt: new Date(r.entryTime).toISOString(),
    })).reverse();
}
/** Count leading consecutive losing rounds (net of fees). Rounds must be newest-first. */
function computeLossStreakFromRounds(rounds) {
    let consecutiveLosses = 0;
    let lastLossTime = 0;
    for (const r of rounds) {
        const net = r.netPnl ?? r.realizedPnL - r.fee - (r.fundingFee ?? 0);
        if (net < -0.01) {
            consecutiveLosses += 1;
            if (lastLossTime === 0)
                lastLossTime = new Date(r.closedAt).getTime();
        }
        else {
            break;
        }
    }
    return { consecutiveLosses, lastLossTime };
}
/**
 * Loss streak from Binance closed rounds (source of truth). Used by the risk
 * guard because DB consecutive_losses freezes when positions close as
 * reconciliation bookkeeping (PnL=0).
 */
async function getBinanceLossStreak(symbol, lookback = 20) {
    const rounds = await fetchBinanceClosedTradeRounds(symbol, lookback);
    return computeLossStreakFromRounds(rounds);
}
async function fetchBinanceClosedTradeRounds(symbol, limit = 20, options = {}) {
    if (process.env.BINANCE_ENABLED !== 'true') {
        return [];
    }
    const symbolUsdt = pairSymbol(symbol);
    const nowMs = options.nowMs ?? Date.now();
    const lookbackMs = options.lookbackMs ?? USER_TRADES_LOOKBACK_MS;
    const cacheTtlMs = options.cacheTtlMs ?? USER_TRADES_CACHE_TTL_MS;
    const cacheKey = `${symbolUsdt}:${lookbackMs}`;
    const cached = roundsCache.get(cacheKey);
    if (cached && cached.expiresAt > nowMs)
        return cached.rounds.slice(0, limit);
    const cutoff = nowMs - lookbackMs;
    const raw = await fetchUserTradesByTimeWindows(symbolUsdt, nowMs, lookbackMs);
    const rounds = aggregateUserTradesToRounds(raw, symbol).filter((r) => new Date(r.closedAt).getTime() >= cutoff);
    const income = await (0, binance_income_service_1.fetchBinanceIncomeRows)({ symbol, startTime: cutoff, endTime: nowMs });
    for (const r of rounds) {
        r.fundingFee = -income.filter(row => row.incomeType === 'FUNDING_FEE' &&
            row.time >= Date.parse(r.openedAt) && row.time <= Date.parse(r.closedAt))
            .reduce((sum, row) => sum + Number(row.income), 0);
        r.netPnl = r.realizedPnL - r.fee - r.fundingFee;
    }
    roundsCache.set(cacheKey, {
        expiresAt: nowMs + Math.max(0, cacheTtlMs),
        rounds,
    });
    return rounds.slice(0, limit);
}
//# sourceMappingURL=binance-trade-history.service.js.map
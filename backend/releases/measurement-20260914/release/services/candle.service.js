"use strict";
/**
 * Unified candle source: Binance klines first, DB cache as fallback.
 * Used by market routes, signal gate, market scan, and LLM input.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCandles = getCandles;
exports.toChartCandles = toChartCandles;
const price_fetcher_1 = require("./price-fetcher");
const market_repository_1 = require("../repositories/market.repository");
const TIMEFRAME_MS = {
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
};
function hoursBackForLimit(timeframe, limit) {
    const barMs = TIMEFRAME_MS[timeframe] ?? 15 * 60 * 1000;
    return Math.ceil((limit * barMs) / (60 * 60 * 1000)) + 24;
}
/** Reject DB rows saved on a wrong cadence (e.g. synthetic 5m ticks). */
function hasValidCandleSpacing(candles, timeframe) {
    if (candles.length < 10)
        return false;
    const expected = TIMEFRAME_MS[timeframe];
    if (!expected)
        return false;
    const times = candles
        .map((c) => new Date(c.timestamp).getTime())
        .filter((t) => Number.isFinite(t))
        .sort((a, b) => a - b);
    if (times.length < 10)
        return false;
    const sampleCount = Math.min(times.length - 1, 24);
    const deltas = [];
    for (let i = times.length - sampleCount; i < times.length; i++) {
        deltas.push(times[i] - times[i - 1]);
    }
    const sorted = [...deltas].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return median >= expected * 0.75 && median <= expected * 1.25;
}
function binanceKlinesToUnified(klines) {
    return klines.map((kline) => ({
        timestamp: kline[0],
        open: parseFloat(String(kline[1])),
        high: parseFloat(String(kline[2])),
        low: parseFloat(String(kline[3])),
        close: parseFloat(String(kline[4])),
        volume: parseFloat(String(kline[5])),
    }));
}
function dbRowsToUnified(rows) {
    return rows.map((c) => ({
        timestamp: new Date(c.timestamp).getTime(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 0,
    }));
}
function dedupeSortAsc(candles) {
    const byTs = new Map();
    for (const c of candles) {
        if (Number.isFinite(c.timestamp)) {
            byTs.set(c.timestamp, c);
        }
    }
    return Array.from(byTs.values()).sort((a, b) => a.timestamp - b.timestamp);
}
async function cacheBinanceCandles(symbol, timeframe, candles) {
    if (candles.length === 0)
        return;
    const batch = candles.map((c) => ({
        coin: symbol,
        timestamp: new Date(c.timestamp),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        timeframe,
    }));
    try {
        await (0, market_repository_1.saveOhlcvCandlesBatch)(batch, { maxBars: 2 });
    }
    catch (err) {
        console.warn(`[CandleService] Failed to cache ${symbol} ${timeframe} candles:`, err instanceof Error ? err.message : err);
    }
}
/**
 * Fetch candles: Binance when available, otherwise validated DB cache.
 */
async function getCandles(options) {
    const { symbol, timeframe, limit = 100, cacheToDb = false } = options;
    const coin = symbol.toUpperCase();
    try {
        const klines = await (0, price_fetcher_1.fetchHistoricalCandles)(coin, timeframe, limit);
        const candles = dedupeSortAsc(binanceKlinesToUnified(klines)).slice(-limit);
        if (candles.length > 0) {
            if (cacheToDb) {
                await cacheBinanceCandles(coin, timeframe, candles);
            }
            return { candles, source: 'binance' };
        }
    }
    catch (err) {
        console.warn(`[CandleService] Binance fetch failed for ${coin} ${timeframe}, trying DB:`, err instanceof Error ? err.message : err);
    }
    const hoursBack = hoursBackForLimit(timeframe, limit);
    const dbRows = await (0, market_repository_1.getOhlcvCandles)(coin, hoursBack, timeframe);
    if (dbRows.length >= Math.min(limit, 10) && hasValidCandleSpacing(dbRows, timeframe)) {
        const candles = dedupeSortAsc(dbRowsToUnified(dbRows)).slice(-limit);
        return { candles, source: 'database' };
    }
    if (dbRows.length > 0) {
        console.warn(`[CandleService] DB candles for ${coin} ${timeframe} fail spacing check — not using degraded data`);
    }
    return { candles: [], source: 'database' };
}
/** Chart API shape (UTC seconds). */
function toChartCandles(candles) {
    return candles.map((c) => ({
        time: Math.floor(c.timestamp / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
    }));
}
//# sourceMappingURL=candle.service.js.map
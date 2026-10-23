"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.timeframeDurationMs = timeframeDurationMs;
exports.candleCloseTimestamp = candleCloseTimestamp;
exports.closedCandlesUpTo = closedCandlesUpTo;
exports.warmupStartTimestamp = warmupStartTimestamp;
exports.estimateBarsForWeeks = estimateBarsForWeeks;
exports.loadBacktestCandles = loadBacktestCandles;
const price_fetcher_1 = require("../services/price-fetcher");
const TF_MS = {
    '5m': 5 * 60_000,
    '15m': 15 * 60_000,
    '1h': 60 * 60_000,
    '4h': 4 * 60 * 60_000,
};
/** Binance kline timestamps are candle open times. */
function timeframeDurationMs(timeframe) {
    const configured = TF_MS[timeframe];
    if (configured)
        return configured;
    const match = /^(\d+)(m|h|d)$/.exec(timeframe.trim());
    if (!match)
        throw new Error(`Unsupported backtest timeframe: ${timeframe}`);
    const amount = parseInt(match[1], 10);
    const unitMs = match[2] === 'm' ? 60_000 : match[2] === 'h' ? 60 * 60_000 : 24 * 60 * 60_000;
    return amount * unitMs;
}
function candleCloseTimestamp(candle, timeframe) {
    return candle.timestamp + timeframeDurationMs(timeframe);
}
function rawRowToCandle(row) {
    return {
        timestamp: row[0],
        open: row[1],
        high: row[2],
        low: row[3],
        close: row[4],
        volume: row[5] ?? 0,
    };
}
/**
 * Return only candles that were fully closed at decision time.
 * Optional `limit` mirrors production's bounded lookback (for example structure=120).
 */
function closedCandlesUpTo(candles, decisionTs, timeframe, limit) {
    const durationMs = timeframeDurationMs(timeframe);
    let lo = 0;
    let hi = candles.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (candles[mid].timestamp + durationMs <= decisionTs)
            lo = mid + 1;
        else
            hi = mid;
    }
    const boundedLimit = limit != null && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null;
    const start = boundedLimit == null ? 0 : Math.max(0, lo - boundedLimit);
    return candles.slice(start, lo);
}
function warmupStartTimestamp(periodStartTs, timeframe, warmupBars) {
    return periodStartTs - Math.max(0, Math.floor(warmupBars)) * timeframeDurationMs(timeframe);
}
function estimateBarsForWeeks(timeframe, weeks) {
    const ms = timeframeDurationMs(timeframe);
    return Math.ceil((weeks * 7 * 24 * 60 * 60_000) / ms) + 200;
}
function estimateBarsForRange(timeframe, fromMs, toMs, extraBars = 200) {
    const ms = timeframeDurationMs(timeframe);
    return Math.ceil((toMs - fromMs) / ms) + extraBars;
}
/**
 * Load OHLCV for backtest window + warmup from Binance Futures.
 */
async function loadBacktestCandles(input) {
    const end = input.endDate ?? new Date();
    const start = input.startDate ?? new Date(end.getTime() - input.weeks * 7 * 24 * 60 * 60_000);
    const byTf = {};
    const warmupBars = input.extraWarmupBarsPerTf ?? input.extraWarmupBars5m ?? 150;
    for (const tf of input.timeframes) {
        const fromTs = warmupStartTimestamp(start.getTime(), tf, warmupBars);
        const limit = estimateBarsForRange(tf, fromTs, end.getTime());
        const raw = await (0, price_fetcher_1.fetchHistoricalCandlesPaginated)(input.symbol, tf, limit, end.getTime());
        const all = raw.map(rawRowToCandle).filter((c) => c.timestamp > 0);
        byTf[tf] = all.filter((c) => c.timestamp >= fromTs && candleCloseTimestamp(c, tf) <= end.getTime());
    }
    const master = byTf['5m'] ?? Object.values(byTf)[0] ?? [];
    const inRange = master.filter((c) => c.timestamp >= start.getTime());
    const periodStart = inRange[0]?.timestamp ?? start.getTime();
    const periodEnd = inRange[inRange.length - 1]?.timestamp ?? end.getTime();
    return {
        byTf,
        period: { start: new Date(periodStart), end: new Date(periodEnd) },
    };
}
//# sourceMappingURL=candle-loader.js.map
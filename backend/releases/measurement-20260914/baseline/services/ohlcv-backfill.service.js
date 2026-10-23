"use strict";
/**
 * Backfill OHLCV from Binance history when DB warmup count is below target.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.backfillOhlcvTimeframe = backfillOhlcvTimeframe;
exports.backfillOhlcvIfNeeded = backfillOhlcvIfNeeded;
exports.isOhlcvBackfillOnStartEnabled = isOhlcvBackfillOnStartEnabled;
const v3_schedulers_1 = require("../config/v3-schedulers");
const market_repository_1 = require("../repositories/market.repository");
const price_fetcher_1 = require("./price-fetcher");
const SAVE_CHUNK = 200;
function klinesToBatch(symbol, timeframe, klines) {
    return klines.map((k) => ({
        coin: symbol.toUpperCase(),
        timestamp: new Date(k[0]),
        open: parseFloat(String(k[1])),
        high: parseFloat(String(k[2])),
        low: parseFloat(String(k[3])),
        close: parseFloat(String(k[4])),
        volume: parseFloat(String(k[5])),
        timeframe,
    }));
}
/**
 * Pull historical klines from Binance and upsert into DB until targetCount rows exist.
 */
async function backfillOhlcvTimeframe(symbol, timeframe, targetCount) {
    const coin = symbol.toUpperCase();
    const before = await (0, market_repository_1.countOhlcvCandles)(coin, timeframe);
    if (before >= targetCount) {
        return { timeframe, before, after: before, fetched: 0, saved: 0, skipped: true };
    }
    console.log(`[OhlcvBackfill] ${coin} ${timeframe}: DB ${before}/${targetCount} — fetching from Binance...`);
    const klines = await (0, price_fetcher_1.fetchHistoricalCandlesPaginated)(coin, timeframe, targetCount);
    const batch = klinesToBatch(coin, timeframe, klines);
    let saved = 0;
    for (let i = 0; i < batch.length; i += SAVE_CHUNK) {
        const chunk = batch.slice(i, i + SAVE_CHUNK);
        saved += await (0, market_repository_1.saveOhlcvCandlesBatch)(chunk);
        if (i + SAVE_CHUNK < batch.length) {
            console.log(`[OhlcvBackfill] ${coin} ${timeframe}: saved ${Math.min(i + SAVE_CHUNK, batch.length)}/${batch.length}`);
        }
    }
    const after = await (0, market_repository_1.countOhlcvCandles)(coin, timeframe);
    console.log(`[OhlcvBackfill] ${coin} ${timeframe}: done ${before} → ${after} (fetched ${klines.length}, upserts ${saved})`);
    return {
        timeframe,
        before,
        after,
        fetched: klines.length,
        saved,
        skipped: false,
    };
}
/** Backfill all V3 gate TFs that are below warmup targets. */
async function backfillOhlcvIfNeeded(symbol = 'BTC') {
    const timeframes = (0, v3_schedulers_1.getV3WarmupTimeframes)();
    const targets = (0, v3_schedulers_1.getV3WarmupRequiredCandles)();
    const results = [];
    for (const tf of timeframes) {
        const target = targets[tf] ?? 100;
        const loaded = await (0, market_repository_1.countOhlcvCandles)(symbol, tf);
        if (loaded < target) {
            results.push(await backfillOhlcvTimeframe(symbol, tf, target));
        }
        else {
            results.push({
                timeframe: tf,
                before: loaded,
                after: loaded,
                fetched: 0,
                saved: 0,
                skipped: true,
            });
        }
    }
    return { symbol: symbol.toUpperCase(), timeframes: results };
}
function isOhlcvBackfillOnStartEnabled() {
    const v = process.env.V3_OHLCV_BACKFILL_ON_START?.trim().toLowerCase();
    return v !== 'false' && v !== '0' && v !== 'off';
}
//# sourceMappingURL=ohlcv-backfill.service.js.map
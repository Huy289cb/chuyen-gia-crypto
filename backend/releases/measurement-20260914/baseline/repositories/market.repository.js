"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveOhlcvCandle = saveOhlcvCandle;
exports.saveOhlcvCandlesBatch = saveOhlcvCandlesBatch;
exports.countOhlcvCandles = countOhlcvCandles;
exports.getOhlcvCandles = getOhlcvCandles;
exports.getLatestOhlcvCandle = getLatestOhlcvCandle;
exports.saveLatestPrice = saveLatestPrice;
exports.getLatestPrice = getLatestPrice;
exports.getAllLatestPrices = getAllLatestPrices;
exports.savePriceHistory = savePriceHistory;
exports.getPriceHistory = getPriceHistory;
const prisma_1 = require("../lib/prisma");
/**
 * Save or update OHLCV candle
 */
async function saveOhlcvCandle(data) {
    const { coin, timestamp, open, high, low, close, volume, timeframe = '15m' } = data;
    const candle = await prisma_1.prisma.ohlcvCandle.upsert({
        where: {
            coin_timestamp_timeframe: {
                coin: coin.toUpperCase(),
                timestamp,
                timeframe,
            },
        },
        update: {
            open,
            high,
            low,
            close,
            volume,
        },
        create: {
            coin: coin.toUpperCase(),
            timestamp,
            open,
            high,
            low,
            close,
            volume,
            timeframe,
        },
    });
    return candle.id;
}
/**
 * Batch save OHLCV candles (sequential upserts; keep maxBars small for DB load).
 */
async function saveOhlcvCandlesBatch(candles, options) {
    const maxBars = options?.maxBars;
    const slice = maxBars != null && maxBars > 0 && candles.length > maxBars
        ? candles.slice(-maxBars)
        : candles;
    let saved = 0;
    for (const candle of slice) {
        await saveOhlcvCandle(candle);
        saved++;
    }
    return saved;
}
/** Count stored bars for warmup progress / backfill checks. */
async function countOhlcvCandles(coin, timeframe) {
    return prisma_1.prisma.ohlcvCandle.count({
        where: {
            coin: coin.toUpperCase(),
            timeframe,
        },
    });
}
/**
 * Get OHLCV candles for a time range
 */
async function getOhlcvCandles(coin, hoursBack = 168, timeframe = '15m') {
    const since = new Date();
    since.setHours(since.getHours() - hoursBack);
    return prisma_1.prisma.ohlcvCandle.findMany({
        where: {
            coin: coin.toUpperCase(),
            timeframe,
            timestamp: { gte: since },
        },
        orderBy: { timestamp: 'asc' },
    });
}
/**
 * Get latest OHLCV candle
 */
async function getLatestOhlcvCandle(coin, timeframe = '15m') {
    return prisma_1.prisma.ohlcvCandle.findFirst({
        where: {
            coin: coin.toUpperCase(),
            timeframe,
        },
        orderBy: { timestamp: 'desc' },
    });
}
/**
 * Save latest price
 */
async function saveLatestPrice(data) {
    const { coin, price, change24h, change7d, marketCap, volume24h } = data;
    const latestPrice = await prisma_1.prisma.latestPrice.upsert({
        where: { coin: coin.toUpperCase() },
        update: {
            price,
            change_24h: change24h,
            change_7d: change7d,
            market_cap: marketCap,
            volume_24h: volume24h,
            updated_at: new Date(),
        },
        create: {
            coin: coin.toUpperCase(),
            price,
            change_24h: change24h,
            change_7d: change7d,
            market_cap: marketCap,
            volume_24h: volume24h,
        },
    });
    return latestPrice.id;
}
/**
 * Get latest price
 */
async function getLatestPrice(coin) {
    return prisma_1.prisma.latestPrice.findUnique({
        where: { coin: coin.toUpperCase() },
    });
}
/**
 * Get all latest prices
 */
async function getAllLatestPrices() {
    return prisma_1.prisma.latestPrice.findMany();
}
/**
 * Save price history entry
 */
async function savePriceHistory(coin, price) {
    const priceHistory = await prisma_1.prisma.priceHistory.create({
        data: {
            coin: coin.toUpperCase(),
            price,
            timestamp: new Date(),
        },
    });
    return priceHistory.id;
}
/**
 * Get price history
 */
async function getPriceHistory(coin, hoursBack = 24) {
    const since = new Date();
    since.setHours(since.getHours() - hoursBack);
    return prisma_1.prisma.priceHistory.findMany({
        where: {
            coin: coin.toUpperCase(),
            timestamp: { gte: since },
        },
        orderBy: { timestamp: 'desc' },
    });
}
//# sourceMappingURL=market.repository.js.map
"use strict";
/**
 * Price Fetcher Service (TypeScript)
 *
 * Primary source: Binance USD-M Futures (BINANCE_BASE_URL — demo-fapi or fapi)
 * Secondary source: Database OHLCV candles
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchRealTimePrices = fetchRealTimePrices;
exports.fetchPricesFromDb = fetchPricesFromDb;
exports.fetchHistoricalCandles = fetchHistoricalCandles;
exports.fetchHistoricalCandlesPaginated = fetchHistoricalCandlesPaginated;
exports.fetchPrices = fetchPrices;
const market_1 = require("./binance/market");
const config_1 = require("./binance/config");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function toFuturesSymbol(coinOrSymbol) {
    const s = coinOrSymbol.toUpperCase();
    return s.endsWith('USDT') ? s : `${s}USDT`;
}
/** Raw kline array shape returned by Binance REST (for legacy callers). */
function klineToRawRow(k) {
    return [
        k.openTime,
        k.open,
        k.high,
        k.low,
        k.close,
        k.volume,
        k.closeTime,
        k.quoteVolume,
        k.trades,
        k.takerBuyBaseVolume,
        k.takerBuyQuoteVolume,
    ];
}
function klineToCandle(k) {
    return {
        price: k.close,
        open: k.open,
        high: k.high,
        low: k.low,
        volume: k.volume,
        time: new Date(k.openTime).toISOString(),
    };
}
/**
 * Fetch real-time 1-minute candle data from Binance USD-M Futures.
 */
async function fetchRealTimePrices() {
    const maxRetries = 3;
    const retryDelay = 1000;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const [btcKlines, ethKlines] = await Promise.all([
                (0, market_1.getKlines)('BTCUSDT', '1m', 1),
                (0, market_1.getKlines)('ETHUSDT', '1m', 1),
            ]);
            if (btcKlines.length === 0 || ethKlines.length === 0) {
                throw new Error('Binance futures klines returned empty');
            }
            return {
                timestamp: new Date().toISOString(),
                btc: klineToCandle(btcKlines[0]),
                eth: klineToCandle(ethKlines[0]),
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[PriceFetcher] Futures 1m candle fetch failed (attempt ${attempt}/${maxRetries}, base=${config_1.config.BASE_URL}):`, message);
            if (attempt < maxRetries) {
                await delay(retryDelay);
                continue;
            }
            throw error;
        }
    }
    throw new Error('Failed to fetch prices after all retries');
}
/**
 * Fetch prices from database (fallback for analysis)
 */
async function fetchPricesFromDb(coin = 'BTC') {
    const { getLatestPrice } = await Promise.resolve().then(() => __importStar(require('../repositories/market.repository')));
    const latestPrice = await getLatestPrice(coin);
    if (latestPrice) {
        return {
            price: latestPrice.price,
            open: latestPrice.price,
            high: latestPrice.price,
            low: latestPrice.price,
            volume: latestPrice.volume_24h || 0,
            time: latestPrice.updated_at.toISOString(),
        };
    }
    return null;
}
/**
 * Fetch historical OHLCV candles from Binance USD-M Futures.
 */
async function fetchHistoricalCandles(symbol, interval = '15m', limit = 100) {
    const maxRetries = 3;
    const retryDelay = 1000;
    const futuresSymbol = toFuturesSymbol(symbol);
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const klines = await (0, market_1.getKlines)(futuresSymbol, interval, limit);
            return klines.map(klineToRawRow);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[PriceFetcher] Futures historical candles fetch failed (attempt ${attempt}/${maxRetries}):`, message);
            if (attempt < maxRetries) {
                await delay(retryDelay);
                continue;
            }
            throw error;
        }
    }
    throw new Error('Failed to fetch historical candles after all retries');
}
const BINANCE_KLINES_MAX = 1000;
/**
 * Fetch up to totalLimit historical klines from Binance Futures (paginated backwards).
 * When `endTimeExclusiveMs` is provided, pagination is anchored strictly before that
 * timestamp instead of implicitly ending at the current Binance server time.
 * Returns ascending rows: [openTime, open, high, low, close, volume, ...].
 */
async function fetchHistoricalCandlesPaginated(symbol, interval, totalLimit, endTimeExclusiveMs) {
    if (totalLimit <= 0)
        return [];
    if (endTimeExclusiveMs != null &&
        (!Number.isFinite(endTimeExclusiveMs) || endTimeExclusiveMs <= 0)) {
        throw new Error(`Invalid historical candle end time: ${endTimeExclusiveMs}`);
    }
    const futuresSymbol = toFuturesSymbol(symbol);
    const byOpenTime = new Map();
    let endTime = endTimeExclusiveMs == null ? undefined : Math.max(0, Math.floor(endTimeExclusiveMs) - 1);
    const pageDelayMs = 250;
    while (byOpenTime.size < totalLimit) {
        const pageSize = Math.min(BINANCE_KLINES_MAX, totalLimit - byOpenTime.size);
        const klines = await (0, market_1.getKlines)(futuresSymbol, interval, pageSize, null, endTime ?? null);
        if (klines.length === 0)
            break;
        for (const kline of klines) {
            byOpenTime.set(kline.openTime, klineToRawRow(kline));
        }
        const oldestOpen = klines[0].openTime;
        endTime = oldestOpen - 1;
        if (klines.length < pageSize)
            break;
        await delay(pageDelayMs);
    }
    return Array.from(byOpenTime.values())
        .sort((a, b) => a[0] - b[0])
        .slice(-totalLimit);
}
/**
 * Fetch prices with fallback chain: Binance Futures -> Database
 */
async function fetchPrices(coin = 'BTC') {
    try {
        const prices = await fetchRealTimePrices();
        const key = coin.toUpperCase();
        if (key === 'ETH' && prices.eth) {
            return prices.eth;
        }
        return prices.btc;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('[PriceFetcher] Binance futures fetch failed, trying database fallback:', message);
        const dbPrice = await fetchPricesFromDb(coin);
        if (dbPrice) {
            return dbPrice;
        }
        throw new Error('Failed to fetch prices from all sources');
    }
}
//# sourceMappingURL=price-fetcher.js.map
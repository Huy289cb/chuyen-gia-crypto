"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLongSide = isLongSide;
exports.signedPositionQty = signedPositionQty;
exports.calculateUnrealizedPnl = calculateUnrealizedPnl;
exports.calculatePnlPercent = calculatePnlPercent;
exports.resolveMarkPrice = resolveMarkPrice;
const price_fetcher_1 = require("./price-fetcher");
const market_repository_1 = require("../repositories/market.repository");
function isLongSide(side) {
    return side.toLowerCase() === 'long' || side.toLowerCase() === 'buy';
}
/** Normalize qty: DB may store shorts as negative size or positive size + side. */
function signedPositionQty(side, sizeQty) {
    const abs = Math.abs(sizeQty);
    if (abs === 0)
        return 0;
    if (sizeQty < 0)
        return sizeQty;
    return isLongSide(side) ? abs : -abs;
}
function calculateUnrealizedPnl(side, entryPrice, markPrice, sizeQty) {
    return (markPrice - entryPrice) * signedPositionQty(side, sizeQty);
}
/** Price move % in the position's favor (not ROE on margin). */
function calculatePnlPercent(side, entryPrice, markPrice) {
    if (entryPrice <= 0 || markPrice <= 0)
        return 0;
    if (isLongSide(side)) {
        return ((markPrice - entryPrice) / entryPrice) * 100;
    }
    return ((entryPrice - markPrice) / entryPrice) * 100;
}
/** Latest mark for dashboard / position display: DB latest_price → live fetch → fallback. */
async function resolveMarkPrice(symbol, fallback) {
    const coin = symbol.toUpperCase().replace(/USDT$/, '');
    try {
        const latest = await (0, market_repository_1.getLatestPrice)(coin);
        if (latest?.price && Number(latest.price) > 0) {
            return Number(latest.price);
        }
    }
    catch {
        // continue to live fetch
    }
    try {
        const db = await (0, price_fetcher_1.fetchPricesFromDb)(coin);
        if (db?.price && db.price > 0) {
            return db.price;
        }
    }
    catch {
        // continue
    }
    try {
        const live = await (0, price_fetcher_1.fetchPrices)(coin);
        if (live?.price && live.price > 0) {
            return live.price;
        }
    }
    catch {
        // use fallback
    }
    return fallback > 0 ? fallback : 0;
}
//# sourceMappingURL=position-mark.js.map
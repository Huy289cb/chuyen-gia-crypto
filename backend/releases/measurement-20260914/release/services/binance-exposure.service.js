"use strict";
/**
 * Live Binance Futures exposure (source of truth for stacking prevention).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBinancePositionRiskUnavailable = isBinancePositionRiskUnavailable;
exports.clearBinancePositionRiskState = clearBinancePositionRiskState;
exports.inferBinancePositionsFromFallback = inferBinancePositionsFromFallback;
exports.fetchBinancePositionRiskRows = fetchBinancePositionRiskRows;
exports.fetchActiveBinancePositions = fetchActiveBinancePositions;
exports.fetchBinanceNetPosition = fetchBinanceNetPosition;
exports.hasBinanceExposureForSide = hasBinanceExposureForSide;
const account_1 = require("./binance/account");
const trading_1 = require("./binance/trading");
const binance_account_health_service_1 = require("./binance-account-health.service");
const binance_position_match_1 = require("../utils/binance-position-match");
const MIN_AMT = 1e-8;
let positionRiskUnavailable = false;
/** True when positionRisk returned demo -1109 and fallback sources were used. */
function isBinancePositionRiskUnavailable() {
    return positionRiskUnavailable;
}
/** Reset exposure probe state (tests). */
function clearBinancePositionRiskState() {
    positionRiskUnavailable = false;
}
function pairSymbol(symbol) {
    return `${symbol.toUpperCase().replace(/USDT$/i, '')}USDT`;
}
function isProtectiveAlgoOrder(order) {
    const t = String(order.orderType ?? order.type ?? '').toUpperCase();
    return t.includes('STOP') || t.includes('TAKE_PROFIT');
}
function protectiveSideToLocal(side) {
    return side.toUpperCase() === 'SELL' ? 'long' : 'short';
}
/**
 * Infer open exposure when positionRisk/account are unavailable on demo (-1109).
 * Uses userTrades net qty, then open algo SL/TP as secondary signal.
 */
async function inferBinancePositionsFromFallback(symbol) {
    const symbolUsdt = symbol ? pairSymbol(symbol) : 'BTCUSDT';
    const base = symbolUsdt.replace(/USDT$/i, '');
    let netAmt = 0;
    let lastPrice = 0;
    try {
        const trades = await (0, trading_1.getUserTrades)(symbolUsdt, { limit: 1000 });
        const sorted = [...trades].sort((a, b) => a.time - b.time);
        for (const t of sorted) {
            const signed = t.side === 'BUY' ? t.qty : -t.qty;
            netAmt += signed;
            if (t.price > 0)
                lastPrice = t.price;
        }
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[BinanceExposure] userTrades fallback failed for ${symbolUsdt}: ${msg}`);
    }
    if (Math.abs(netAmt) >= MIN_AMT) {
        const side = netAmt > 0 ? 'long' : 'short';
        return [
            {
                symbol: base,
                symbolUsdt,
                side,
                positionAmt: Math.abs(netAmt),
                entryPrice: lastPrice,
                markPrice: lastPrice,
                rawPositionSide: 'BOTH',
            },
        ];
    }
    try {
        const algos = await (0, trading_1.getOpenAlgoOrders)(symbolUsdt);
        const protective = algos.filter(isProtectiveAlgoOrder);
        if (protective.length === 0)
            return [];
        const side = protectiveSideToLocal(String(protective[0].side ?? ''));
        const qty = Math.max(...protective.map((o) => Number(o.quantity ?? o.origQty ?? 0)));
        if (qty < MIN_AMT)
            return [];
        const trigger = Number(protective[0].triggerPrice ?? protective[0].stopPrice ?? protective[0].price ?? 0) ||
            lastPrice;
        return [
            {
                symbol: base,
                symbolUsdt,
                side,
                positionAmt: qty,
                entryPrice: trigger,
                markPrice: trigger,
                rawPositionSide: 'BOTH',
            },
        ];
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[BinanceExposure] openAlgoOrders fallback failed for ${symbolUsdt}: ${msg}`);
        return [];
    }
}
function parsedToRiskRow(position) {
    const signedAmt = position.side === 'short' ? -position.positionAmt : position.positionAmt;
    return {
        symbol: position.symbolUsdt,
        positionAmt: signedAmt,
        entryPrice: position.entryPrice,
        markPrice: position.markPrice,
        positionSide: position.rawPositionSide,
    };
}
async function fetchBinancePositionRiskRows(symbol, opts) {
    const symbolUsdt = symbol
        ? `${symbol.toUpperCase().replace(/USDT$/i, '')}USDT`
        : null;
    const allowFallback = opts?.allowUserTradesFallback !== false;
    positionRiskUnavailable = false;
    try {
        const rows = await (0, account_1.getPositionRisk)(symbolUsdt);
        return Array.isArray(rows) ? rows : [];
    }
    catch (error) {
        if ((0, binance_account_health_service_1.isBinanceDemoMetadataUnavailableError)(error)) {
            positionRiskUnavailable = true;
            if (!allowFallback) {
                console.warn('[BinanceExposure] positionRisk unavailable on demo (-1109); strict mode — no userTrades fallback');
                return [];
            }
            console.warn('[BinanceExposure] positionRisk unavailable on demo (-1109); falling back to userTrades/openAlgoOrders');
            const inferred = await inferBinancePositionsFromFallback(symbol);
            return inferred.map(parsedToRiskRow);
        }
        throw error;
    }
}
async function fetchActiveBinancePositions(symbol, opts) {
    const rows = await fetchBinancePositionRiskRows(symbol, opts);
    return (0, binance_position_match_1.listActiveBinancePositions)(rows);
}
async function fetchBinanceNetPosition(symbol) {
    const rows = await fetchBinancePositionRiskRows(symbol);
    const active = (0, binance_position_match_1.listActiveBinancePositions)(rows);
    const base = symbol.toUpperCase().replace(/USDT$/i, '');
    return active.find((p) => p.symbol === base) ?? null;
}
async function hasBinanceExposureForSide(symbol, side) {
    const rows = await fetchBinancePositionRiskRows(symbol);
    const match = (0, binance_position_match_1.findBinancePositionForSide)(rows, symbol, side);
    return match !== null && match.positionAmt >= MIN_AMT;
}
//# sourceMappingURL=binance-exposure.service.js.map
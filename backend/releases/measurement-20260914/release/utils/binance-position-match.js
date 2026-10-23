"use strict";
/**
 * Normalize Binance positionRisk rows for ONE_WAY (positionSide BOTH) and HEDGE modes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.localSideFromPositionAmt = localSideFromPositionAmt;
exports.parseBinancePositionRisk = parseBinancePositionRisk;
exports.findBinancePositionForSide = findBinancePositionForSide;
exports.listActiveBinancePositions = listActiveBinancePositions;
const MIN_AMT = 1e-8;
function localSideFromPositionAmt(amt) {
    if (!Number.isFinite(amt) || Math.abs(amt) < MIN_AMT)
        return null;
    return amt > 0 ? 'long' : 'short';
}
function parseBinancePositionRisk(row) {
    const symbolUsdt = String(row.symbol ?? '').toUpperCase();
    if (!symbolUsdt)
        return null;
    const positionAmt = parseFloat(String(row.positionAmt ?? '0'));
    const side = localSideFromPositionAmt(positionAmt);
    if (!side)
        return null;
    const entryPrice = parseFloat(String(row.entryPrice ?? '0'));
    const markPrice = parseFloat(String(row.markPrice ?? '0'));
    const unRealizedProfit = parseFloat(String(row.unRealizedProfit ?? 'NaN'));
    const notional = parseFloat(String(row.notional ?? 'NaN'));
    return {
        symbol: symbolUsdt.replace(/USDT$/i, ''),
        symbolUsdt,
        side,
        positionAmt: Math.abs(positionAmt),
        entryPrice: Number.isFinite(entryPrice) ? entryPrice : 0,
        markPrice: Number.isFinite(markPrice) ? markPrice : 0,
        unRealizedProfit: Number.isFinite(unRealizedProfit) ? unRealizedProfit : undefined,
        notional: Number.isFinite(notional) ? notional : undefined,
        rawPositionSide: String(row.positionSide ?? 'BOTH').toUpperCase(),
    };
}
function findBinancePositionForSide(rows, symbol, side) {
    const base = symbol.toUpperCase().replace(/USDT$/i, '');
    for (const row of rows) {
        const parsed = parseBinancePositionRisk(row);
        if (parsed && parsed.symbol === base && parsed.side === side) {
            return parsed;
        }
    }
    return null;
}
function listActiveBinancePositions(rows) {
    const out = [];
    for (const row of rows) {
        const parsed = parseBinancePositionRisk(row);
        if (parsed)
            out.push(parsed);
    }
    return out;
}
//# sourceMappingURL=binance-position-match.js.map
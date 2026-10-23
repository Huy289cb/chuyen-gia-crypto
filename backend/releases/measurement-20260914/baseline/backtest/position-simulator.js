"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkBarForExit = checkBarForExit;
exports.closePositionAt = closePositionAt;
exports.simulatePositionExit = simulatePositionExit;
function checkBarForExit(pos, bar) {
    const isLong = pos.side === 'long';
    const slHit = isLong ? bar.low <= pos.stopLoss : bar.high >= pos.stopLoss;
    const tpHit = isLong ? bar.high >= pos.takeProfit : bar.low <= pos.takeProfit;
    if (slHit && tpHit) {
        return { closePrice: pos.stopLoss, closeReason: 'stop_loss' };
    }
    if (slHit) {
        return { closePrice: pos.stopLoss, closeReason: 'stop_loss' };
    }
    if (tpHit) {
        return { closePrice: pos.takeProfit, closeReason: 'take_profit' };
    }
    return null;
}
function closePositionAt(pos, closeTime, closePrice, closeReason, barsHeld) {
    const qty = pos.notionalUsd / pos.entryPrice;
    const raw = (closePrice - pos.entryPrice) * qty;
    const pnlUsd = pos.side === 'long' ? raw : -raw;
    const feeUsd = (pos.entryPrice + closePrice) * qty * pos.feePctPerSide;
    const slippageUsd = pos.notionalUsd * (pos.slippagePct ?? 0);
    const netPnl = pnlUsd - feeUsd - slippageUsd;
    const pnlPct = (netPnl / pos.notionalUsd) * 100;
    return {
        side: pos.side,
        timeframe: pos.timeframe,
        playbookKey: pos.playbookKey,
        grade: pos.grade,
        entryTime: pos.entryTime,
        entryPrice: pos.entryPrice,
        stopLoss: pos.stopLoss,
        takeProfit: pos.takeProfit,
        slDistancePct: pos.slDistancePct,
        rr: pos.rr,
        closeTime,
        closePrice,
        closeReason,
        pnlUsd: netPnl,
        pnlPct,
        barsHeld,
        notionalUsd: pos.notionalUsd, feeUsd, slippageUsd,
    };
}
/** Scan forward from fromBarIndex for SL/TP (end-of-run flush). */
function simulatePositionExit(pos, bars, fromBarIndex) {
    for (let i = fromBarIndex; i < bars.length; i++) {
        const hit = checkBarForExit(pos, bars[i]);
        if (hit) {
            return closePositionAt(pos, bars[i].timestamp, hit.closePrice, hit.closeReason, i - pos.entryBarIndex);
        }
    }
    const last = bars[bars.length - 1];
    if (!last || last.timestamp <= pos.entryTime)
        return null;
    return closePositionAt(pos, last.timestamp, last.close, 'end_of_data', bars.length - 1 - pos.entryBarIndex);
}
//# sourceMappingURL=position-simulator.js.map
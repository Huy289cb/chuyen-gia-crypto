"use strict";
/**
 * Shared amend of exchange STOP + local stop_loss (profit-protect / invalidation).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.amendProtectiveStopLoss = amendProtectiveStopLoss;
const testnet_repository_1 = require("../repositories/testnet.repository");
const binanceClient_1 = require("./binanceClient");
const binance_hedge_mode_1 = require("./binance-hedge-mode");
async function amendProtectiveStopLoss(input) {
    const { position, newSl, mark, eventType, action, reason, meta } = input;
    if (process.env.BINANCE_ENABLED !== 'true') {
        return { ok: false, reason: 'binance disabled' };
    }
    const side = position.side.toLowerCase() === 'short' ? 'short' : 'long';
    const qty = Math.abs(Number(position.size_qty));
    if (!Number.isFinite(qty) || qty <= 0) {
        return { ok: false, reason: 'invalid qty' };
    }
    if (!Number.isFinite(newSl) || newSl <= 0) {
        return { ok: false, reason: 'invalid newSl' };
    }
    if (side === 'long' && newSl >= mark) {
        return { ok: false, reason: `new SL ${newSl} >= mark ${mark}` };
    }
    if (side === 'short' && newSl <= mark) {
        return { ok: false, reason: `new SL ${newSl} <= mark ${mark}` };
    }
    await (0, binance_hedge_mode_1.ensurePositionModeDetected)();
    const symbolUsdt = `${position.symbol.toUpperCase().replace(/USDT$/i, '')}USDT`;
    const closeSide = side === 'long' ? 'SELL' : 'BUY';
    const mode = (0, binance_hedge_mode_1.getPositionMode)();
    const currentPosition = {
        positionAmt: side === 'long' ? qty : -qty,
        ...(mode === 'HEDGE' ? { positionSide: side === 'long' ? 'LONG' : 'SHORT' } : {}),
    };
    const oldSlId = position.binance_sl_order_id ? String(position.binance_sl_order_id) : null;
    // Place new first — avoid naked window. ponytail: cancel fail → two STOP algos briefly.
    let newSlId;
    try {
        const slOrder = await (0, binanceClient_1.placeStopLossOrder)({}, symbolUsdt, closeSide, qty, newSl, 'CLOSE', currentPosition, null);
        newSlId = String(slOrder.orderId ?? slOrder.algoId);
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: `place SL failed: ${msg}` };
    }
    if (oldSlId && oldSlId !== newSlId) {
        try {
            await (0, binanceClient_1.cancelAlgoOrder)({}, symbolUsdt, oldSlId);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`[AmendSL] New SL ${newSlId} placed but cancel old ${oldSlId} failed: ${msg}`);
        }
    }
    await (0, testnet_repository_1.updateTestnetPosition)(position.position_id, {
        stop_loss: newSl,
        binance_sl_order_id: newSlId,
    });
    await (0, testnet_repository_1.recordTestnetTradeEvent)(position.position_id, eventType, {
        action,
        reason,
        old_sl: position.stop_loss,
        new_sl: newSl,
        mark,
        old_sl_id: oldSlId,
        new_sl_id: newSlId,
        timestamp: new Date().toISOString(),
        ...meta,
    });
    return { ok: true, reason, newSlId };
}
//# sourceMappingURL=amend-protective-sl.service.js.map
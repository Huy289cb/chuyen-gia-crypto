"use strict";
/**
 * P1.6 — Protective orders: recompute SL/TP from actual fill, handle -2021, emergency close.
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
exports.isPastStopLoss = isPastStopLoss;
exports.isPastTakeProfit = isPastTakeProfit;
exports.tpInvalidForMark = tpInvalidForMark;
exports.evaluateProtectiveAction = evaluateProtectiveAction;
exports.isOrderWouldTriggerImmediatelyError = isOrderWouldTriggerImmediatelyError;
exports.recomputeSlTpFromFill = recomputeSlTpFromFill;
exports.extractOpenAlgoOrderIds = extractOpenAlgoOrderIds;
exports.fetchOpenAlgoOrderIds = fetchOpenAlgoOrderIds;
exports.reconcileStaleProtectiveOrderIds = reconcileStaleProtectiveOrderIds;
exports.placeProtectiveOrdersForPosition = placeProtectiveOrdersForPosition;
exports.emergencyMarketCloseUnhedged = emergencyMarketCloseUnhedged;
exports.arePlannedLevelsValidForFill = arePlannedLevelsValidForFill;
exports.resolveLevelsForFill = resolveLevelsForFill;
const risk_policy_1 = require("../config/risk-policy");
const testnet_repository_1 = require("../repositories/testnet.repository");
const binanceClient_1 = require("./binanceClient");
const binance_hedge_mode_1 = require("./binance-hedge-mode");
const position_close_service_1 = require("./position-close.service");
const telegram_notify_service_1 = require("./telegram/telegram-notify.service");
const PROTECTIVE_RETRY_COOLDOWN_MS = 2 * 60_000;
const PROTECTIVE_MARK_MOVE_THRESHOLD = 0.005;
const protectiveRetryState = new Map();
function isPastStopLoss(side, stop_loss, mark) {
    if (!Number.isFinite(mark) || mark <= 0)
        return false;
    return side === 'long' ? mark <= stop_loss : mark >= stop_loss;
}
function isPastTakeProfit(side, take_profit, mark) {
    if (!Number.isFinite(mark) || mark <= 0)
        return false;
    return side === 'long' ? mark >= take_profit : mark <= take_profit;
}
function tpInvalidForMark(side, take_profit, mark) {
    const s = side.toLowerCase();
    if (s === 'short')
        return take_profit >= mark;
    return take_profit <= mark;
}
/**
 * Decide protective action from planned/recomputed levels vs current mark.
 */
function evaluateProtectiveAction(params) {
    const { side, stop_loss, take_profit, mark, levels } = params;
    if (!Number.isFinite(mark) || mark <= 0)
        return 'place_sl_tp';
    const sl = levels?.stop_loss ?? stop_loss;
    const tp = levels?.take_profit ?? take_profit;
    if (isPastStopLoss(side, sl, mark))
        return 'close_at_market_loss';
    if (isPastTakeProfit(side, tp, mark))
        return 'close_at_market_profit';
    if (slTpInvalidForMark(side, sl, mark) || tpInvalidForMark(side, tp, mark)) {
        return 'recompute_and_place';
    }
    return 'place_sl_tp';
}
function shouldSkipProtectiveRetry(positionId, mark) {
    const state = protectiveRetryState.get(positionId);
    if (!state)
        return false;
    if (Date.now() - state.failedAt >= PROTECTIVE_RETRY_COOLDOWN_MS)
        return false;
    if (state.markAtFail <= 0 || mark <= 0)
        return true;
    const move = Math.abs(mark - state.markAtFail) / state.markAtFail;
    return move < PROTECTIVE_MARK_MOVE_THRESHOLD;
}
function recordProtectiveFailure(positionId, mark) {
    protectiveRetryState.set(positionId, { failedAt: Date.now(), markAtFail: mark });
}
function clearProtectiveRetryState(positionId) {
    protectiveRetryState.delete(positionId);
}
function notifyProtectiveAction(position, title, detail) {
    (0, telegram_notify_service_1.notifyAlert)(title, `${position.symbol} ${position.side} ${position.position_id}: ${detail}`, `protective:${position.position_id}:${title}`);
}
function isOrderWouldTriggerImmediatelyError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('-2021') || message.toLowerCase().includes('immediately trigger');
}
/**
 * Recompute SL/TP from fill price while preserving planned risk distance and R:R.
 */
function recomputeSlTpFromFill(params) {
    const { side, fillPrice, plannedEntry, plannedSl, plannedTp, markPrice, minSlDistancePercent = (0, risk_policy_1.getRiskPolicy)().minSlDistancePercent, } = params;
    if (!Number.isFinite(fillPrice) || fillPrice <= 0) {
        return { stop_loss: plannedSl, take_profit: plannedTp };
    }
    const entry = Number.isFinite(plannedEntry) && plannedEntry > 0 ? plannedEntry : fillPrice;
    let stop_loss;
    let take_profit;
    if (side === 'short') {
        const riskDist = Math.max(plannedSl - entry, entry * minSlDistancePercent);
        const rewardDist = Math.max(entry - plannedTp, riskDist);
        stop_loss = fillPrice + riskDist;
        take_profit = fillPrice - rewardDist;
        if (markPrice != null && markPrice > 0 && stop_loss <= markPrice) {
            stop_loss = markPrice * (1 + minSlDistancePercent);
        }
    }
    else {
        const riskDist = Math.max(entry - plannedSl, entry * minSlDistancePercent);
        const rewardDist = Math.max(plannedTp - entry, riskDist);
        stop_loss = fillPrice - riskDist;
        take_profit = fillPrice + rewardDist;
        if (markPrice != null && markPrice > 0 && stop_loss >= markPrice) {
            stop_loss = markPrice * (1 - minSlDistancePercent);
        }
    }
    return { stop_loss, take_profit };
}
function slTpInvalidForMark(side, stop_loss, mark) {
    const s = side.toLowerCase();
    if (s === 'short')
        return stop_loss <= mark;
    return stop_loss >= mark;
}
function pairSymbol(symbol) {
    return `${symbol.toUpperCase().replace(/USDT$/i, '')}USDT`;
}
function extractOpenAlgoOrderIds(orders) {
    const rows = Array.isArray(orders) ? orders : [];
    const ids = new Set();
    for (const row of rows) {
        if (!row || typeof row !== 'object')
            continue;
        const o = row;
        const id = String(o.algoId ?? o.orderId ?? '');
        if (id)
            ids.add(id);
    }
    return ids;
}
/** Fetch live algo order ids; empty set on failure (treat DB ids as stale). */
async function fetchOpenAlgoOrderIds(symbol) {
    try {
        const { getOpenAlgoOrders } = await Promise.resolve().then(() => __importStar(require('./binanceClient')));
        const orders = await getOpenAlgoOrders({}, pairSymbol(symbol));
        return extractOpenAlgoOrderIds(orders);
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[ProtectiveOrder] openAlgoOrders fetch failed for ${symbol}: ${msg}`);
        return new Set();
    }
}
/**
 * Clear DB SL/TP ids that no longer exist on Binance (e.g. after demo wallet reset).
 */
async function reconcileStaleProtectiveOrderIds(position) {
    const slId = position.binance_sl_order_id ? String(position.binance_sl_order_id) : null;
    const tpId = position.binance_tp_order_id ? String(position.binance_tp_order_id) : null;
    if (!slId && !tpId) {
        return {
            binance_sl_order_id: null,
            binance_tp_order_id: null,
            clearedSl: false,
            clearedTp: false,
        };
    }
    const openIds = await fetchOpenAlgoOrderIds(position.symbol);
    let clearedSl = false;
    let clearedTp = false;
    let newSlId = slId;
    let newTpId = tpId;
    if (slId && !openIds.has(slId)) {
        clearedSl = true;
        newSlId = null;
    }
    if (tpId && !openIds.has(tpId)) {
        clearedTp = true;
        newTpId = null;
    }
    if (clearedSl || clearedTp) {
        await (0, testnet_repository_1.updateTestnetPosition)(position.position_id, {
            ...(clearedSl ? { binance_sl_order_id: null } : {}),
            ...(clearedTp ? { binance_tp_order_id: null } : {}),
        });
        console.warn(`[ProtectiveOrder] Cleared stale algo ids for ${position.position_id}: ` +
            `sl=${clearedSl ? `${slId}→cleared` : 'ok'} tp=${clearedTp ? `${tpId}→cleared` : 'ok'} ` +
            `(openAlgos=${openIds.size})`);
    }
    return {
        binance_sl_order_id: newSlId,
        binance_tp_order_id: newTpId,
        clearedSl,
        clearedTp,
    };
}
async function placeSlTpOnBinance(positionId, symbol, positionSideLocal, executedQty, levels, opts) {
    await (0, binance_hedge_mode_1.ensurePositionModeDetected)();
    const symbolUsdt = `${symbol.toUpperCase().replace(/USDT$/i, '')}USDT`;
    const closeSide = positionSideLocal === 'long' ? 'SELL' : 'BUY';
    const signedAmt = positionSideLocal === 'long' ? executedQty : -executedQty;
    const mode = (0, binance_hedge_mode_1.getPositionMode)();
    const currentPosition = {
        positionAmt: signedAmt,
        ...(mode === 'HEDGE'
            ? { positionSide: positionSideLocal === 'long' ? 'LONG' : 'SHORT' }
            : {}),
    };
    const client = {};
    let slId;
    let tpId;
    let slError;
    let tpError;
    if (!opts?.skipSl) {
        try {
            const slOrder = await (0, binanceClient_1.placeStopLossOrder)(client, symbolUsdt, closeSide, executedQty, levels.stop_loss, 'CLOSE', currentPosition, null);
            slId = String(slOrder.orderId);
        }
        catch (error) {
            slError = error instanceof Error ? error.message : String(error);
        }
    }
    if (!opts?.skipTp) {
        try {
            const tpOrder = await (0, binanceClient_1.placeTakeProfitOrder)(client, symbolUsdt, closeSide, executedQty, levels.take_profit, 'CLOSE', currentPosition, null);
            tpId = String(tpOrder.orderId);
        }
        catch (error) {
            tpError = error instanceof Error ? error.message : String(error);
        }
    }
    if (slId || tpId) {
        await (0, testnet_repository_1.updateTestnetPosition)(positionId, {
            ...(slId ? { binance_sl_order_id: slId } : {}),
            ...(tpId ? { binance_tp_order_id: tpId } : {}),
            stop_loss: levels.stop_loss,
            take_profit: levels.take_profit,
        });
    }
    return { slId, tpId, slError, tpError };
}
async function marketCloseFromProtective(position, mark, closeReason, eventReason) {
    const label = closeReason === 'protective_sl_breached_market'
        ? 'SL breached — market close'
        : closeReason === 'protective_tp_reached_market'
            ? 'TP reached — market close'
            : 'Protective failed — market close';
    console.warn(`[ProtectiveOrder] ${position.position_id} ${label} mark=${mark} (${eventReason})`);
    notifyProtectiveAction(position, label, `mark=${mark} reason=${eventReason}`);
    return emergencyMarketCloseUnhedged(position, mark, eventReason, closeReason);
}
/**
 * Place or repair SL/TP; market-close if SL cannot be placed safely.
 */
async function placeProtectiveOrdersForPosition(position) {
    const reconciled = await reconcileStaleProtectiveOrderIds(position);
    position = {
        ...position,
        binance_sl_order_id: reconciled.binance_sl_order_id,
        binance_tp_order_id: reconciled.binance_tp_order_id,
    };
    if (position.binance_sl_order_id && position.binance_tp_order_id) {
        return 'skipped';
    }
    const qty = Math.abs(Number(position.size_qty));
    if (!Number.isFinite(qty) || qty <= 0)
        return 'skipped';
    const side = position.side.toLowerCase() === 'short' ? 'short' : 'long';
    let mark = 0;
    try {
        const { fetchBinanceNetPosition } = await Promise.resolve().then(() => __importStar(require('./binance-exposure.service')));
        const live = await fetchBinanceNetPosition(position.symbol);
        mark = live?.markPrice ?? 0;
    }
    catch {
        /* proceed */
    }
    if (mark > 0 && shouldSkipProtectiveRetry(position.position_id, mark)) {
        console.log(`[ProtectiveOrder] Skip retry for ${position.position_id} (cooldown, mark=${mark})`);
        return 'skipped';
    }
    const plannedAction = evaluateProtectiveAction({
        side,
        stop_loss: position.stop_loss,
        take_profit: position.take_profit,
        mark,
    });
    if (plannedAction === 'close_at_market_loss') {
        const closed = await marketCloseFromProtective(position, mark, 'protective_sl_breached_market', 'price_past_planned_sl');
        return closed ? 'closed' : 'partial';
    }
    if (plannedAction === 'close_at_market_profit') {
        const closed = await marketCloseFromProtective(position, mark, 'protective_tp_reached_market', 'price_past_planned_tp');
        return closed ? 'closed' : 'partial';
    }
    let fillRef = position.entry_price;
    if (mark > 0 &&
        (plannedAction === 'recompute_and_place' ||
            slTpInvalidForMark(side, position.stop_loss, mark) ||
            slTpInvalidForMark(side, recomputeSlTpFromFill({
                side,
                fillPrice: position.entry_price,
                plannedEntry: position.entry_price,
                plannedSl: position.stop_loss,
                plannedTp: position.take_profit,
            }).stop_loss, mark))) {
        fillRef =
            side === 'short'
                ? Math.max(position.entry_price, mark)
                : Math.min(position.entry_price, mark);
        console.warn(`[ProtectiveOrder] Recompute levels for ${position.position_id}: fillRef=${fillRef} mark=${mark}`);
    }
    const levels = recomputeSlTpFromFill({
        side,
        fillPrice: fillRef,
        plannedEntry: position.entry_price,
        plannedSl: position.stop_loss,
        plannedTp: position.take_profit,
        markPrice: mark > 0 ? mark : undefined,
    });
    const levelAction = evaluateProtectiveAction({
        side,
        stop_loss: position.stop_loss,
        take_profit: position.take_profit,
        mark,
        levels,
    });
    if (levelAction === 'close_at_market_loss') {
        const closed = await marketCloseFromProtective(position, mark, 'protective_sl_breached_market', 'recomputed_sl_breached');
        return closed ? 'closed' : 'partial';
    }
    if (levelAction === 'close_at_market_profit') {
        const closed = await marketCloseFromProtective(position, mark, 'protective_tp_reached_market', 'recomputed_tp_reached');
        return closed ? 'closed' : 'partial';
    }
    const hadSl = Boolean(position.binance_sl_order_id);
    const hadTp = Boolean(position.binance_tp_order_id);
    const skipTpInvalid = mark > 0 && tpInvalidForMark(side, levels.take_profit, mark);
    let result = await placeSlTpOnBinance(position.position_id, position.symbol, position.side, qty, levels, { skipSl: hadSl, skipTp: hadTp || skipTpInvalid });
    let placedSlId = result.slId;
    let placedTpId = result.tpId;
    if (!result.slId &&
        !hadSl &&
        result.slError &&
        isOrderWouldTriggerImmediatelyError(result.slError) &&
        mark > 0) {
        if (isPastStopLoss(side, levels.stop_loss, mark)) {
            const closed = await marketCloseFromProtective(position, mark, 'protective_sl_breached_market', 'sl_-2021_past_sl');
            return closed ? 'closed' : 'partial';
        }
        const retryLevels = recomputeSlTpFromFill({
            side,
            fillPrice: mark,
            plannedEntry: position.entry_price,
            plannedSl: position.stop_loss,
            plannedTp: position.take_profit,
            markPrice: mark,
            minSlDistancePercent: (0, risk_policy_1.getRiskPolicy)().minSlDistancePercent +
                parseFloat(process.env.SL_PLACEMENT_MARK_BUFFER_PCT || '0.001'),
        });
        console.warn(`[ProtectiveOrder] SL -2021 for ${position.position_id}, retry SL=${retryLevels.stop_loss} (mark=${mark})`);
        result = await placeSlTpOnBinance(position.position_id, position.symbol, position.side, qty, retryLevels, {
            skipTp: hadTp ||
                Boolean(placedTpId) ||
                tpInvalidForMark(side, retryLevels.take_profit, mark),
        });
        placedSlId = placedSlId ?? result.slId;
        placedTpId = placedTpId ?? result.tpId;
        Object.assign(levels, retryLevels);
        if (!result.slId &&
            result.slError &&
            isOrderWouldTriggerImmediatelyError(result.slError) &&
            isPastStopLoss(side, retryLevels.stop_loss, mark)) {
            const closed = await marketCloseFromProtective(position, mark, 'protective_sl_breached_market', 'sl_-2021_retry_still_past_sl');
            return closed ? 'closed' : 'partial';
        }
    }
    const slProtected = hadSl || Boolean(placedSlId);
    const tpProtected = hadTp || Boolean(placedTpId);
    if (slProtected) {
        clearProtectiveRetryState(position.position_id);
        if (!tpProtected) {
            if (!hadTp &&
                result.tpError &&
                isOrderWouldTriggerImmediatelyError(result.tpError) &&
                mark > 0) {
                if (isPastTakeProfit(side, levels.take_profit, mark)) {
                    const closed = await marketCloseFromProtective(position, mark, 'protective_tp_reached_market', 'tp_-2021_past_tp');
                    return closed ? 'closed' : 'partial';
                }
                console.warn(`[ProtectiveOrder] TP -2021 for ${position.position_id} — SL ok, skipping invalid TP (mark=${mark})`);
            }
            else {
                const reason = skipTpInvalid
                    ? `tp_invalid_for_mark mark=${mark}`
                    : result.tpError ?? 'tp_missing_after_placement';
                console.warn(`[ProtectiveOrder] TP missing for ${position.position_id} while SL is protected: ${reason}`);
            }
            notifyProtectiveAction(position, 'Protective partial', `SL active but TP missing (${result.tpError ?? (skipTpInvalid ? 'tp_invalid_for_mark' : 'unknown')})`);
            return 'partial';
        }
        console.log(`[ProtectiveOrder] SL/TP protected for ${position.position_id}: ` +
            `sl=${levels.stop_loss} id=${placedSlId ?? position.binance_sl_order_id} ` +
            `tp=${levels.take_profit} id=${placedTpId ?? position.binance_tp_order_id}`);
        return 'ok';
    }
    recordProtectiveFailure(position.position_id, mark);
    console.error(`[ProtectiveOrder] SL failed for ${position.position_id}: ${result.slError ?? 'unknown'} — emergency market close`);
    const closed = await marketCloseFromProtective(position, mark, 'protective_failed_market_close', result.slError ?? 'sl_placement_failed');
    return closed ? 'closed' : 'partial';
}
async function emergencyMarketCloseUnhedged(position, closePrice, eventReason, closeReason = 'protective_failed_market_close') {
    const mark = closePrice > 0 ? closePrice : position.entry_price;
    const bypassGuard = closeReason === 'protective_sl_breached_market' ||
        closeReason === 'protective_tp_reached_market';
    const guardSource = eventReason === 'monitor_unhedged_sl_progress'
        ? 'position_monitor_unhedged'
        : closeReason;
    const { prisma: db } = await Promise.resolve().then(() => __importStar(require('../lib/prisma')));
    const full = await db.testnetPosition.findUnique({
        where: { position_id: position.position_id },
        include: { account: true },
    });
    const closeResult = await (0, position_close_service_1.closePositionOnBinanceMarket)({
        symbol: position.symbol,
        side: position.side,
        size_qty: position.size_qty,
    }, undefined, {
        guardSource,
        bypassLifecycleGuard: bypassGuard,
        positionId: position.position_id,
        entryTime: full?.entry_time ?? null,
    });
    if (!closeResult.ok) {
        const deferred = closeResult.reason?.includes('lifecycle_guard');
        if (deferred) {
            console.warn(`[ProtectiveOrder] Deferred emergency close for ${position.position_id}: ${closeResult.reason}`);
            return false;
        }
        console.error(`[ProtectiveOrder] Emergency close failed for ${position.position_id}: ${closeResult.reason}`);
        await (0, testnet_repository_1.recordTestnetTradeEvent)(position.position_id, 'protective_failed', {
            reason: eventReason ?? 'sl_placement_failed',
            close_reason: closeReason,
            close_error: closeResult.reason,
            timestamp: new Date().toISOString(),
        });
        return false;
    }
    if (full?.status === 'open') {
        await (0, position_close_service_1.closeLocalPosition)({ ...full, account: full.account }, mark, closeReason, { verified_binance_zero: true });
    }
    await (0, testnet_repository_1.recordTestnetTradeEvent)(position.position_id, 'protective_failed', {
        reason: eventReason ?? 'sl_placement_failed',
        close_reason: closeReason,
        action: 'market_close',
        close_price: mark,
        timestamp: new Date().toISOString(),
    });
    return true;
}
/** Planned SL/TP still valid relative to actual fill (long: SL < fill < TP; short: TP < fill < SL). */
function arePlannedLevelsValidForFill(side, fillPrice, plannedSl, plannedTp) {
    if (!Number.isFinite(fillPrice) || fillPrice <= 0)
        return false;
    if (!Number.isFinite(plannedSl) || !Number.isFinite(plannedTp))
        return false;
    if (side === 'short') {
        return plannedTp < fillPrice && fillPrice < plannedSl;
    }
    return plannedSl < fillPrice && fillPrice < plannedTp;
}
/** Levels for a new fill before DB insert — preserve pending SL/TP when still valid for fill. */
function resolveLevelsForFill(side, fillPrice, plannedEntry, plannedSl, plannedTp, markPrice) {
    const s = side.toLowerCase() === 'short' ? 'short' : 'long';
    if (arePlannedLevelsValidForFill(s, fillPrice, plannedSl, plannedTp)) {
        return { stop_loss: plannedSl, take_profit: plannedTp };
    }
    return recomputeSlTpFromFill({
        side: s,
        fillPrice,
        plannedEntry,
        plannedSl: plannedSl,
        plannedTp: plannedTp,
        markPrice,
    });
}
//# sourceMappingURL=protective-order.service.js.map
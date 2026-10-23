"use strict";
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
exports.RECOVERY_FILL_MAX_AGE_MS = void 0;
exports.resolveFillAvgPrice = resolveFillAvgPrice;
exports.resolveFillQty = resolveFillQty;
exports.hasEntryFillBeenNotified = hasEntryFillBeenNotified;
exports.materializePositionFromPendingFill = materializePositionFromPendingFill;
exports.ensureProtectiveOrdersForPosition = ensureProtectiveOrdersForPosition;
exports.recoverPendingOrderFromBinance = recoverPendingOrderFromBinance;
exports.parseV3ClientOrderId = parseV3ClientOrderId;
exports.findLocalOrderForBinanceEvent = findLocalOrderForBinanceEvent;
const execution_risk_1 = require("../utils/execution-risk");
const risk_policy_1 = require("../config/risk-policy");
/**
 * Shared logic for Binance order fill price resolution and pending → position materialization.
 */
const testnet_repository_1 = require("../repositories/testnet.repository");
const prisma_1 = require("../lib/prisma");
const protective_order_service_1 = require("./protective-order.service");
const binance_account_health_service_1 = require("./binance-account-health.service");
function resolveFillAvgPrice(order, executedQty, fallbackEntryPrice) {
    const ap = parseFloat(order.ap ?? '');
    if (Number.isFinite(ap) && ap > 0)
        return ap;
    const lastFilled = parseFloat(order.L ?? '');
    if (Number.isFinite(lastFilled) && lastFilled > 0)
        return lastFilled;
    const qty = executedQty > 0 ? executedQty : parseFloat(order.z ?? '0');
    const quote = parseFloat(order.Z ?? '0');
    if (qty > 0 && Number.isFinite(quote) && quote > 0)
        return quote / qty;
    const limitPrice = parseFloat(order.p ?? '');
    if (Number.isFinite(limitPrice) && limitPrice > 0)
        return limitPrice;
    if (fallbackEntryPrice && Number.isFinite(fallbackEntryPrice) && fallbackEntryPrice > 0) {
        return fallbackEntryPrice;
    }
    return 0;
}
function resolveFillQty(order, executedQty) {
    if (executedQty > 0)
        return executedQty;
    const z = parseFloat(order.z ?? '0');
    return Number.isFinite(z) && z > 0 ? z : 0;
}
/** Reconciliation may only materialize a fill this recent (WS miss window). Older = mark executed, no position. */
exports.RECOVERY_FILL_MAX_AGE_MS = 15 * 60 * 1000;
/** Skip duplicate "Mở vị thế" when WS already notified before a recovery pass. */
async function hasEntryFillBeenNotified(orderId) {
    const { prisma: db } = await Promise.resolve().then(() => __importStar(require('../lib/prisma')));
    const recent = await db.testnetTradeEvent.findMany({
        where: { event_type: 'entry_order_filled' },
        orderBy: { timestamp: 'desc' },
        take: 80,
        select: { event_data: true },
    });
    for (const ev of recent) {
        if (!ev.event_data)
            continue;
        try {
            const data = JSON.parse(ev.event_data);
            if (data.order_id === orderId)
                return true;
        }
        catch {
            /* skip malformed */
        }
    }
    return false;
}
async function markPendingExecutedWithoutPosition(localOrder, avgPrice, qty, reason, linkPositionId) {
    if (linkPositionId) {
        await (0, testnet_repository_1.executeTestnetPendingOrder)(localOrder.order_id, linkPositionId);
    }
    else {
        await (0, testnet_repository_1.updateTestnetPendingOrder)(localOrder.order_id, {
            status: 'executed_historical',
            executed_at: new Date(),
            executed_price: avgPrice,
            executed_size_qty: qty,
            close_reason: reason,
        });
    }
    console.log(`[BinanceOrderFill] Pending ${localOrder.order_id} closed in ledger only (${reason})` +
        (linkPositionId ? ` linked=${linkPositionId}` : ''));
}
async function recordIncompleteProtectiveOutcome(positionId, outcome, context) {
    if (outcome !== 'partial')
        return;
    await (0, testnet_repository_1.recordTestnetTradeEvent)(positionId, 'protective_order_incomplete', {
        outcome,
        context,
        timestamp: new Date().toISOString(),
    });
}
async function findStrictActiveBinanceExposure(symbol, side) {
    try {
        const { fetchActiveBinancePositions } = await Promise.resolve().then(() => __importStar(require('./binance-exposure.service')));
        const active = await fetchActiveBinancePositions(symbol, {
            allowUserTradesFallback: false,
        });
        const base = String(symbol).toUpperCase().replace(/USDT$/i, '');
        const localSide = String(side).toLowerCase() === 'short' ? 'short' : 'long';
        return (active.find((p) => p.symbol === base &&
            p.side === localSide &&
            Number.isFinite(p.positionAmt) &&
            p.positionAmt > 1e-8) ?? null);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[BinanceOrderFill] Active exposure probe failed for ${symbol}: ${message}`);
        return null;
    }
}
/**
 * Create open position from a filled pending order and place SL/TP on Binance.
 */
async function materializePositionFromPendingFill(localOrder, executedQty, avgPrice, eventTime, options) {
    if (localOrder.binance_order_id) {
        const existing = await (0, testnet_repository_1.findTestnetPositionByBinanceOrderId)(localOrder.binance_order_id);
        if (existing) {
            if (localOrder.status !== 'executed') {
                await (0, testnet_repository_1.executeTestnetPendingOrder)(localOrder.order_id, existing.position_id);
            }
            const { prisma: db } = await Promise.resolve().then(() => __importStar(require('../lib/prisma')));
            const full = await db.testnetPosition.findUnique({
                where: { position_id: existing.position_id },
            });
            if (full) {
                const outcome = await (0, protective_order_service_1.placeProtectiveOrdersForPosition)(full);
                await recordIncompleteProtectiveOutcome(existing.position_id, outcome, 'existing_position_fill_link');
            }
            return existing.position_id;
        }
    }
    if (!Number.isFinite(avgPrice) || avgPrice <= 0) {
        console.error(`[BinanceOrderFill] Invalid avgPrice for order ${localOrder.order_id}: ${avgPrice}`);
        return null;
    }
    const liveExposure = await findStrictActiveBinanceExposure(localOrder.symbol, localOrder.side);
    if (!liveExposure) {
        console.warn(`[BinanceOrderFill] Refuse materialize ${localOrder.order_id} — no live ${localOrder.side} exposure on Binance`);
        return null;
    }
    const qty = Math.abs(executedQty);
    if (!Number.isFinite(qty) || qty <= 0) {
        console.error(`[BinanceOrderFill] Invalid executedQty for order ${localOrder.order_id}: ${executedQty}`);
        return null;
    }
    const positionId = `pos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sizeUsd = qty * avgPrice;
    const plannedEntry = Number(localOrder.entry_price) > 0 ? Number(localOrder.entry_price) : avgPrice;
    let mark;
    try {
        const { fetchBinanceNetPosition } = await Promise.resolve().then(() => __importStar(require('./binance-exposure.service')));
        const live = await fetchBinanceNetPosition(localOrder.symbol);
        if (live?.markPrice && live.markPrice > 0)
            mark = live.markPrice;
    }
    catch {
        /* optional */
    }
    const levels = (0, protective_order_service_1.resolveLevelsForFill)(localOrder.side, avgPrice, plannedEntry, localOrder.stop_loss, localOrder.take_profit, mark);
    const policy = (0, risk_policy_1.getRiskPolicy)();
    const plannedBalance = localOrder.risk_percent > 0 ? localOrder.risk_usd * 100 / localOrder.risk_percent : 0;
    const actualRisk = plannedBalance > 0 ? (0, execution_risk_1.computeExecutionRisk)({ entry: avgPrice, stopLoss: levels.stop_loss,
        quantity: qty, balance: plannedBalance, roundTripFeePercent: Math.max(0.1, policy.maxFeePercent),
        slippagePercent: Math.max(0.1, policy.maxSlippagePercent) }) : null;
    await (0, testnet_repository_1.createTestnetPosition)({
        positionId,
        accountId: localOrder.account_id,
        symbol: localOrder.symbol,
        side: localOrder.side,
        entryPrice: avgPrice,
        stopLoss: levels.stop_loss,
        takeProfit: levels.take_profit,
        sizeUsd,
        sizeQty: qty,
        riskUsd: actualRisk?.totalRiskUsd ?? localOrder.risk_usd,
        riskPercent: actualRisk?.riskPercent ?? localOrder.risk_percent,
        expectedRr: localOrder.expected_rr,
        linkedPredictionId: localOrder.linked_prediction_id ?? undefined,
        binanceOrderId: localOrder.binance_order_id ?? undefined,
        binanceSlOrderId: undefined,
        binanceTpOrderId: undefined,
        tpLevels: undefined,
        tpHitCount: 0,
        partialClosed: 0,
        entryFee: 0,
    });
    await (0, testnet_repository_1.executeTestnetPendingOrder)(localOrder.order_id, positionId);
    let linkedDecisionId;
    try {
        const { prisma: db } = await Promise.resolve().then(() => __importStar(require('../lib/prisma')));
        const { PIPELINE_EVENT_POSITION_ID } = await Promise.resolve().then(() => __importStar(require('../repositories/testnet.repository')));
        const linkEvents = await db.testnetTradeEvent.findMany({
            where: {
                position_id: PIPELINE_EVENT_POSITION_ID,
                event_type: 'pending_order_linked',
            },
            orderBy: { timestamp: 'desc' },
            take: 30,
        });
        for (const ev of linkEvents) {
            if (!ev.event_data)
                continue;
            const data = JSON.parse(ev.event_data);
            if (data.order_id === localOrder.order_id && typeof data.decision_id === 'number') {
                linkedDecisionId = data.decision_id;
                break;
            }
        }
    }
    catch {
        /* non-fatal */
    }
    const { resolveTestnetAccountBalances } = await Promise.resolve().then(() => __importStar(require('./binance-balance-sync.service')));
    const balances = await resolveTestnetAccountBalances(localOrder.account_id);
    const entryAlreadyNotified = await hasEntryFillBeenNotified(localOrder.order_id);
    const skipEntryTelegram = options?.suppressTelegram === true ||
        options?.reconciliationBackfill === true ||
        entryAlreadyNotified;
    await (0, testnet_repository_1.recordTestnetTradeEvent)(positionId, 'entry_order_filled', {
        order_id: localOrder.order_id,
        binance_order_id: localOrder.binance_order_id,
        symbol: localOrder.symbol,
        side: localOrder.side,
        entry_price: avgPrice,
        planned_entry: plannedEntry,
        initial_risk_usd: actualRisk?.totalRiskUsd ?? localOrder.risk_usd,
        initial_execution_risk: actualRisk,
        planned_risk_usd: localOrder.risk_usd,
        stop_loss: levels.stop_loss,
        take_profit: levels.take_profit,
        executed_qty: qty,
        size_qty: qty,
        size_usd: sizeUsd,
        account_balance: balances.account_balance,
        account_equity: balances.account_equity,
        ...(skipEntryTelegram ? { suppress_telegram: true } : {}),
        ...(options?.reconciliationBackfill ? { reconciliation_backfill: true } : {}),
        timestamp: new Date(eventTime ?? Date.now()).toISOString(),
        ...(linkedDecisionId != null ? { decision_id: linkedDecisionId } : {}),
    });
    const { prisma: db } = await Promise.resolve().then(() => __importStar(require('../lib/prisma')));
    const created = await db.testnetPosition.findUnique({ where: { position_id: positionId } });
    if (created) {
        const outcome = await (0, protective_order_service_1.placeProtectiveOrdersForPosition)(created);
        await recordIncompleteProtectiveOutcome(positionId, outcome, 'new_position_fill');
    }
    console.log(`[BinanceOrderFill] Position ${positionId} from order ${localOrder.order_id} @ ${avgPrice} SL=${levels.stop_loss} TP=${levels.take_profit}`);
    return positionId;
}
/**
 * Place SL/TP on Binance when missing (fill handler + reconciliation).
 */
async function ensureProtectiveOrdersForPosition(position) {
    const outcome = await (0, protective_order_service_1.placeProtectiveOrdersForPosition)({
        ...position,
        entry_price: position.entry_price ?? 0,
    });
    await recordIncompleteProtectiveOutcome(position.position_id, outcome, 'reconciliation_ensure');
    return outcome;
}
/**
 * Recover a single pending row using Binance order query (reconciliation / repair).
 */
async function recoverPendingOrderFromBinance(localOrder) {
    if (!localOrder.binance_order_id) {
        return 'failed';
    }
    const { getOrder } = await Promise.resolve().then(() => __importStar(require('./binance/trading')));
    const symbol = `${localOrder.symbol}USDT`;
    try {
        const remote = await getOrder(symbol, Number(localOrder.binance_order_id));
        if (remote.status === 'FILLED') {
            const qty = remote.executedQty > 0 ? remote.executedQty : 0;
            let avg = qty > 0 && remote.cummulativeQuoteQty > 0
                ? remote.cummulativeQuoteQty / qty
                : remote.price;
            if (!Number.isFinite(avg) || avg <= 0) {
                avg = localOrder.entry_price;
            }
            const fillAgeMs = remote.updateTime ? Date.now() - remote.updateTime : Number.POSITIVE_INFINITY;
            const symbolBase = String(localOrder.symbol).toUpperCase();
            // Prefer existing local rows first; stale fills may still need protective recovery.
            const existingPos = localOrder.binance_order_id
                ? await (0, testnet_repository_1.findTestnetPositionByBinanceOrderId)(localOrder.binance_order_id)
                : null;
            if (existingPos) {
                if (localOrder.status !== 'executed' && localOrder.status !== 'executed_historical') {
                    await (0, testnet_repository_1.executeTestnetPendingOrder)(localOrder.order_id, existingPos.position_id);
                }
                const full = await prisma_1.prisma.testnetPosition.findUnique({
                    where: { position_id: existingPos.position_id },
                });
                if (full) {
                    await ensureProtectiveOrdersForPosition(full);
                }
                return 'filled';
            }
            // ONE_WAY: at most one open local row per symbol.
            const openForSymbol = await prisma_1.prisma.testnetPosition.findFirst({
                where: { account_id: localOrder.account_id, symbol: symbolBase, status: 'open' },
            });
            if (openForSymbol) {
                await markPendingExecutedWithoutPosition(localOrder, avg, qty, 'open_position_exists', openForSymbol.position_id);
                await ensureProtectiveOrdersForPosition(openForSymbol);
                return 'stale_skipped';
            }
            if (fillAgeMs > exports.RECOVERY_FILL_MAX_AGE_MS) {
                const activeExposure = await findStrictActiveBinanceExposure(localOrder.symbol, localOrder.side);
                if (!activeExposure) {
                    await markPendingExecutedWithoutPosition(localOrder, avg, qty, 'fill_too_old');
                    return 'stale_skipped';
                }
                const recoveredQty = activeExposure.positionAmt > 0 ? activeExposure.positionAmt : qty;
                const recoveredAvg = activeExposure.entryPrice > 0
                    ? activeExposure.entryPrice
                    : avg > 0
                        ? avg
                        : localOrder.entry_price;
                console.warn(`[BinanceOrderFill] Old fill ${localOrder.order_id} still active on Binance; ` +
                    `materializing for protective recovery qty=${recoveredQty} entry=${recoveredAvg}`);
                const positionId = await materializePositionFromPendingFill({
                    ...localOrder,
                    entry_price: recoveredAvg,
                }, recoveredQty, recoveredAvg, remote.updateTime, { reconciliationBackfill: true });
                return positionId ? 'filled' : 'failed';
            }
            const activeExposure = await findStrictActiveBinanceExposure(localOrder.symbol, localOrder.side);
            if (!activeExposure) {
                const { wasRecentEmergencyMarketClose } = await Promise.resolve().then(() => __importStar(require('./position-lifecycle-guard.service')));
                const reason = wasRecentEmergencyMarketClose(localOrder.symbol, localOrder.side)
                    ? 'fill_no_exposure_after_emergency_close'
                    : 'fill_no_live_exposure';
                await markPendingExecutedWithoutPosition(localOrder, avg, qty, reason);
                console.warn(`[BinanceOrderFill] Skip materialize for ${localOrder.order_id} — FILLED but no live ${localOrder.side} on Binance (${reason})`);
                return 'stale_skipped';
            }
            const positionId = await materializePositionFromPendingFill(localOrder, qty, avg, remote.updateTime);
            return positionId ? 'filled' : 'failed';
        }
        if (remote.status === 'CANCELED' || remote.status === 'EXPIRED' || remote.status === 'REJECTED') {
            await (0, testnet_repository_1.updateTestnetPendingOrder)(localOrder.order_id, {
                status: remote.status.toLowerCase(),
            });
            return 'cancelled';
        }
        if (remote.status === 'NEW' || remote.status === 'PARTIALLY_FILLED') {
            await (0, testnet_repository_1.updateTestnetPendingOrder)(localOrder.order_id, { status: 'pending' });
            return 'unchanged';
        }
        return 'unchanged';
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if ((0, binance_account_health_service_1.isBinanceOrderStateProbeUnavailable)(error)) {
            console.warn(`[BinanceOrderFill] recover ${localOrder.order_id} deferred (Binance probe unavailable): ${message}`);
            return 'api_unavailable';
        }
        console.error(`[BinanceOrderFill] recover ${localOrder.order_id} failed:`, message);
        return 'failed';
    }
}
const WS_FILL_LOOKUP_RETRIES = 3;
const WS_FILL_LOOKUP_DELAY_MS = 500;
function sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Parse x-v3_<ts>_<suffix> → v3_<ts>_<suffix> */
function parseV3ClientOrderId(clientOrderId) {
    if (!clientOrderId || typeof clientOrderId !== 'string')
        return null;
    const trimmed = clientOrderId.trim();
    if (trimmed.startsWith('x-v3_'))
        return trimmed.slice(2);
    if (trimmed.startsWith('x-') && trimmed.includes('v3_'))
        return trimmed.slice(2);
    if (trimmed.startsWith('v3_'))
        return trimmed;
    return null;
}
async function findLocalOrderForBinanceEvent(binanceOrderId, symbolUsdt, clientOrderId) {
    const symbol = symbolUsdt.replace(/USDT/i, '').toUpperCase();
    const orderIdFromClient = parseV3ClientOrderId(clientOrderId);
    for (let attempt = 0; attempt < WS_FILL_LOOKUP_RETRIES; attempt++) {
        const byBinance = await (0, testnet_repository_1.getTestnetPendingOrderByBinanceId)(binanceOrderId, symbol);
        if (byBinance)
            return byBinance;
        if (orderIdFromClient) {
            const { getTestnetPendingOrderByOrderId } = await Promise.resolve().then(() => __importStar(require('../repositories/testnet.repository')));
            const byOrderId = await getTestnetPendingOrderByOrderId(orderIdFromClient);
            if (byOrderId)
                return byOrderId;
        }
        if (attempt < WS_FILL_LOOKUP_RETRIES - 1) {
            await sleepMs(WS_FILL_LOOKUP_DELAY_MS);
        }
    }
    return null;
}
//# sourceMappingURL=binance-order-fill.service.js.map
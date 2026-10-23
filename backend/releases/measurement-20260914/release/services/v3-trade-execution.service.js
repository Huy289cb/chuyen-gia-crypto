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
exports.executeV3Trade = executeV3Trade;
const entry_trace_1 = require("../utils/entry-trace");
const methods_1 = require("../config/methods");
const risk_policy_1 = require("../config/risk-policy");
const v3_entry_policy_1 = require("../config/v3-entry-policy");
const account_risk_guard_service_1 = require("./account-risk-guard.service");
const binance_account_health_service_1 = require("./binance-account-health.service");
const opposite_flip_service_1 = require("./opposite-flip.service");
const v3_entry_eligibility_service_1 = require("./v3-entry-eligibility.service");
const testnet_repository_1 = require("../repositories/testnet.repository");
const binance_hedge_mode_1 = require("./binance-hedge-mode");
const order_quantity_1 = require("../utils/order-quantity");
const trade_levels_1 = require("../utils/trade-levels");
const execution_risk_1 = require("../utils/execution-risk");
const binanceClient_1 = require("./binanceClient");
const telegram_hooks_1 = require("./telegram/telegram-hooks");
function isValidNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
function normalizeSide(action) {
    const a = action.toLowerCase();
    if (a === 'buy' || a === 'long')
        return 'long';
    if (a === 'sell' || a === 'short')
        return 'short';
    return null;
}
function validatePriceLevels(side, entry, stopLoss, takeProfit) {
    if (side === 'long') {
        if (stopLoss >= entry)
            return 'LONG requires stop_loss < entry';
        if (takeProfit <= entry)
            return 'LONG requires take_profit > entry';
    }
    else {
        if (stopLoss <= entry)
            return 'SHORT requires stop_loss > entry';
        if (takeProfit >= entry)
            return 'SHORT requires take_profit < entry';
    }
    return null;
}
/**
 * Execute an LLM-approved trade on Binance testnet (limit entry + pending order row).
 */
async function executeV3Trade(input) {
    const trace = input.trace ?? (0, entry_trace_1.currentEntryTrace)() ?? (0, entry_trace_1.createEntryTrace)({
        lane: 'direct_execution', decision_id: input.decisionRecordId,
    }, (0, risk_policy_1.getRiskPolicy)());
    return (0, entry_trace_1.withEntryTrace)(trace, async () => {
        await (0, entry_trace_1.recordEntryStage)('admission_started');
        try {
            const result = await executeV3TradeTraced(input);
            await (0, entry_trace_1.recordEntryStage)(result.success ? 'order_pending' : 'admission_rejected', {
                rejection_code: result.rejectionCode ?? (result.success ? null : 'other_guard'),
                reason: result.reason, order_id: result.orderId, binance_order_id: result.binanceOrderId
            });
            return result;
        }
        catch (error) {
            await (0, entry_trace_1.recordEntryStage)('execution_error');
            throw error;
        }
    });
}
async function executeV3TradeTraced(input) {
    const { symbol, timeframe, analysis, methodId = 'kim_nghia', decisionRecordId, requiredMinRr, } = input;
    if (process.env.BINANCE_ENABLED !== 'true') {
        const reason = 'BINANCE_ENABLED is not true — cannot place live testnet order';
        return { success: false, reason };
    }
    const side = normalizeSide(String(analysis.action || ''));
    if (!side) {
        return { success: false, reason: `Invalid action for trade: ${analysis.action}` };
    }
    const entry = Number(analysis.suggested_entry);
    const stopLoss = Number(analysis.suggested_stop_loss);
    const takeProfit = Number(analysis.suggested_take_profit);
    if (!isValidNumber(entry) || !isValidNumber(stopLoss) || !isValidNumber(takeProfit)) {
        return { success: false, rejectionCode: 'missing_data', reason: 'Missing or invalid entry / stop_loss / take_profit' };
    }
    const levelError = validatePriceLevels(side, entry, stopLoss, takeProfit);
    if (levelError) {
        return { success: false, rejectionCode: 'invalid_levels', reason: levelError };
    }
    const auto = (0, methods_1.getMethodConfig)(methodId).autoEntry;
    const riskPolicy = (0, risk_policy_1.getRiskPolicy)();
    const minSlDistancePercent = riskPolicy.minSlDistancePercent > 0
        ? riskPolicy.minSlDistancePercent
        : auto.minSLDistancePercent;
    const slCheck = (0, trade_levels_1.checkMinSlDistance)(entry, stopLoss, minSlDistancePercent);
    if (!slCheck.ok) {
        return {
            success: false,
            rejectionCode: 'stop_floor',
            reason: `SL distance ${(slCheck.distancePct * 100).toFixed(2)}% below min ${(slCheck.minPct * 100).toFixed(2)}%`,
        };
    }
    const slDistancePct = slCheck.distancePct;
    const account = await (0, testnet_repository_1.getOrCreateTestnetAccount)(symbol, methodId, 10000);
    const accountGuard = await (0, account_risk_guard_service_1.assertTestnetAccountCanOpenTrade)(account.id, symbol);
    if (!accountGuard.allowed) {
        return { success: false, reason: accountGuard.reason };
    }
    const binanceHealth = await (0, binance_account_health_service_1.checkBinanceAccountTradable)();
    if (!binanceHealth.tradable) {
        return { success: false, reason: binanceHealth.reason };
    }
    const balance = Number(account.current_balance ?? account.equity ?? 10000);
    if ((0, v3_entry_policy_1.isV3OppositeFlipEnabled)()) {
        const flip = await (0, opposite_flip_service_1.tryOppositeFlipBeforeEntry)({
            symbol,
            methodId,
            newSide: side,
            analysis,
            timeframe,
        });
        if (flip.reason !== 'no opposite exposure' && !flip.flipped) {
            return { success: false, reason: flip.reason };
        }
    }
    const sideBlockReason = await (0, v3_entry_eligibility_service_1.assertScaleInSideAllowed)(symbol, side);
    if (sideBlockReason) {
        return { success: false, reason: sideBlockReason };
    }
    const chaseBlock = await (0, v3_entry_eligibility_service_1.assertSameSidePostCloseCooldown)(symbol, side, methodId);
    if (chaseBlock) {
        return { success: false, reason: chaseBlock };
    }
    const [openPositions, pendingOrders] = await Promise.all([
        (0, testnet_repository_1.getActiveTestnetPositions)({ symbol, methodId }),
        (0, testnet_repository_1.getBlockingTestnetPendingOrders)({ symbol, methodId }),
    ]);
    const scaleIn = (0, v3_entry_policy_1.isV3ScaleInEnabled)();
    const opposite = (0, v3_entry_eligibility_service_1.oppositeLocalSide)(side);
    if (scaleIn) {
        const oppositeOpen = openPositions.filter((p) => String(p.side).toLowerCase() === opposite);
        if (oppositeOpen.length > 0 && !(0, v3_entry_policy_1.isV3OppositeFlipEnabled)()) {
            return {
                success: false,
                reason: `Opposite ${opposite} position open — cannot open ${side}`,
            };
        }
        const oppositePending = pendingOrders.filter((o) => String(o.side).toLowerCase() === opposite);
        if (oppositePending.length > 0) {
            return {
                success: false,
                reason: `Opposite ${opposite} pending order exists`,
            };
        }
        const unresolved = pendingOrders.filter((o) => o.status === 'reconciliation_failed_not_on_binance');
        if (unresolved.length > 0) {
            const blocking = unresolved[0];
            return {
                success: false,
                reason: `Unresolved ${side} pending order ${blocking.order_id} (reconcile pending — Binance state unknown)`,
            };
        }
    }
    else {
        const sameSideOpen = openPositions.filter((p) => String(p.side).toLowerCase() === side);
        if (sameSideOpen.length > 0) {
            return {
                success: false,
                reason: `Same-side ${side} position already open (scaling-in disabled)`,
            };
        }
        const sameSidePending = pendingOrders.filter((o) => String(o.side).toLowerCase() === side);
        if (sameSidePending.length > 0) {
            const blocking = sameSidePending[0];
            const status = String(blocking.status ?? 'pending');
            return {
                success: false,
                reason: status === 'reconciliation_failed_not_on_binance'
                    ? `Unresolved ${side} pending order ${blocking.order_id} (reconcile pending — Binance state unknown)`
                    : `Same-side ${side} pending order already exists`,
            };
        }
        const maxPerSymbol = riskPolicy.maxPositionsPerSymbol;
        if (openPositions.length >= maxPerSymbol || pendingOrders.length >= maxPerSymbol) {
            return {
                success: false,
                reason: `Max positions/orders per symbol (${maxPerSymbol}) reached`,
            };
        }
    }
    const exposure = await (0, v3_entry_eligibility_service_1.getSymbolExposureSnapshot)(symbol, methodId);
    const totalExposure = exposure.totalUsd;
    const maxExposure = exposure.maxExposureUsd;
    if (totalExposure >= maxExposure) {
        return {
            success: false,
            rejectionCode: 'exposure',
            reason: `Max exposure reached (${totalExposure.toFixed(0)}/${maxExposure} USD open+pending)`,
        };
    }
    const remainingCapacity = exposure.remainingUsd;
    const minNotional = (0, v3_entry_policy_1.getBinanceMinOrderNotionalUsd)();
    const notionalTolerance = (0, v3_entry_policy_1.getNotionalTolerancePercent)();
    const targetRiskUsd = balance * (riskPolicy.riskPerTradePercent / 100);
    const computedSizeUsd = targetRiskUsd / slDistancePct;
    const sizeUsd = (0, v3_entry_policy_1.resolveTargetPositionNotionalUsd)({
        computedUsd: computedSizeUsd,
        minNotionalUsd: minNotional,
        remainingCapacityUsd: remainingCapacity,
    });
    if (sizeUsd <= 0) {
        return { success: false, rejectionCode: 'min_notional', reason: 'Computed position size <= 0' };
    }
    const minNotionalFloor = (0, v3_entry_policy_1.minNotionalWithTolerance)(minNotional, notionalTolerance);
    if (sizeUsd < minNotionalFloor) {
        const headroomMsg = exposure.openUsd > 0
            ? `Scale-in headroom $${remainingCapacity.toFixed(0)} below Binance min order $${minNotional}`
            : `Order notional $${sizeUsd.toFixed(0)} well below Binance minimum $${minNotional}`;
        return { success: false, rejectionCode: remainingCapacity < minNotionalFloor ? 'exposure' : 'min_notional', reason: headroomMsg };
    }
    const sizeQty = sizeUsd / entry;
    const symbolUsdt = `${symbol.toUpperCase()}USDT`;
    const qtyCheck = await (0, binanceClient_1.normalizeQuantityForSymbol)(symbolUsdt, sizeQty);
    const qtyResolved = (0, order_quantity_1.resolveQuantityForMinNotional)({
        quantity: sizeQty,
        entryPrice: entry,
        minNotionalUsd: minNotional,
        stepSize: qtyCheck.stepSize,
        minQty: qtyCheck.minQty,
        maxNotionalUsd: remainingCapacity,
        tolerancePercent: notionalTolerance,
    });
    await (0, entry_trace_1.recordEntryStage)('quantity_checked', { raw_quantity: sizeQty, normalized_quantity: qtyResolved.normalizedQty,
        min_qty: qtyCheck.minQty, step_size: qtyCheck.stepSize, min_notional: minNotional,
        remaining_exposure_usd: remainingCapacity, order_notional: qtyResolved.orderNotional,
        raised_to_minimum: qtyResolved.normalizedQty > sizeQty, rejection_code: qtyResolved.code ?? null });
    if (!qtyResolved.valid) {
        return {
            success: false,
            rejectionCode: qtyResolved.code ?? 'quantity_unknown',
            reason: qtyResolved.reason ?? 'Order quantity invalid after exchange normalization',
        };
    }
    const normalizedSizeQty = qtyResolved.normalizedQty;
    const orderNotional = qtyResolved.orderNotional;
    const effectiveSizeUsd = orderNotional;
    // Preserve the strategy's invalidation and target. Wallet size is never a reason
    // to tighten a structural stop or manufacture a more distant target.
    const risk = (0, execution_risk_1.computeExecutionRisk)({ entry, stopLoss, quantity: normalizedSizeQty, balance,
        roundTripFeePercent: Math.max(0.1, riskPolicy.maxFeePercent),
        slippagePercent: Math.max(0.1, riskPolicy.maxSlippagePercent) });
    const effectiveRiskUsd = risk.totalRiskUsd;
    const effectiveRiskPercent = risk.riskPercent;
    const levelAdjustment = undefined;
    const effectiveRiskCapUsd = (0, execution_risk_1.resolveExecutionRiskCapUsd)({ balance,
        maxRiskPercent: riskPolicy.maxEffectiveRiskPerTradePercent, maxRiskUsd: riskPolicy.maxEffectiveRiskPerTradeUsd });
    await (0, entry_trace_1.recordEntryStage)('risk_checked', { ...risk, cap_usd: effectiveRiskCapUsd,
        remaining_daily_risk_usd: accountGuard.remainingDailyRiskUsd ?? null });
    if (effectiveRiskUsd > effectiveRiskCapUsd + 1e-9) {
        return {
            success: false,
            rejectionCode: 'risk_cap',
            reason: `Exchange minimum would risk ${effectiveRiskPercent.toFixed(2)}% of wallet after fees/slippage ` +
                `(cap ${effectiveRiskCapUsd.toFixed(4)} USDT)`,
        };
    }
    const expectedRr = (0, trade_levels_1.computeExpectedRrFromPrices)(entry, stopLoss, takeProfit) ??
        Number(analysis.expected_rr) ??
        0;
    const minRr = requiredMinRr ?? auto.minRRRatio;
    if (!Number.isFinite(expectedRr) || expectedRr + 1e-9 < minRr) {
        return { success: false, rejectionCode: 'rr', reason: `R:R ${expectedRr.toFixed(2)} below minimum ${minRr}` };
    }
    const invalidation = Number(analysis.invalidation_level);
    if (Number.isFinite(invalidation) && invalidation > 0 &&
        ((side === 'long' && (invalidation >= entry || stopLoss > invalidation)) ||
            (side === 'short' && (invalidation <= entry || stopLoss < invalidation)))) {
        return { success: false, reason: 'Stop must protect the structural invalidation level' };
    }
    if (riskPolicy.circuitDailyLossEnabled && accountGuard.remainingDailyRiskUsd != null &&
        effectiveRiskUsd > accountGuard.remainingDailyRiskUsd + 1e-9) {
        return { success: false, rejectionCode: 'daily_risk', reason: 'Projected stop loss after costs exceeds remaining daily loss budget' };
    }
    const orderId = `v3_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newClientOrderId = `x-${orderId}`;
    const client = (0, binanceClient_1.initTestnetClient)();
    if (!client) {
        return { success: false, reason: 'Binance client unavailable' };
    }
    await (0, binance_hedge_mode_1.ensurePositionModeDetected)();
    const binanceSide = side === 'long' ? 'BUY' : 'SELL';
    let binanceOrderId;
    await (0, entry_trace_1.recordEntryStage)('order_submitting', { order_id: orderId, client_order_id: newClientOrderId });
    try {
        const order = await (0, binanceClient_1.placeLimitOrder)(client, symbolUsdt, binanceSide, normalizedSizeQty, entry, 'OPEN', null, null, newClientOrderId);
        binanceOrderId = String(order.orderId);
        console.log(`[V3TradeExecution] Binance limit order ${binanceOrderId} (${newClientOrderId}) ` +
            `${symbol} ${timeframe} ${side} entry=${entry} sizeUsd=${effectiveSizeUsd.toFixed(2)} ` +
            `riskUsd=${effectiveRiskUsd.toFixed(4)} riskPct=${effectiveRiskPercent.toFixed(2)}`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[V3TradeExecution] Binance order failed: ${message}`);
        return { success: false, rejectionCode: 'exchange_submission_unknown', reason: `Binance order placement failed: ${message}` };
    }
    await (0, testnet_repository_1.createTestnetPendingOrder)({
        orderId,
        accountId: account.id,
        symbol: symbol.toUpperCase(),
        side,
        entryPrice: entry,
        stopLoss,
        takeProfit,
        sizeUsd: effectiveSizeUsd,
        sizeQty: normalizedSizeQty,
        riskUsd: effectiveRiskUsd,
        riskPercent: effectiveRiskPercent,
        expectedRr,
        invalidationLevel: isValidNumber(analysis.invalidation_level)
            ? analysis.invalidation_level
            : undefined,
        methodId,
        binanceOrderId,
    });
    (0, telegram_hooks_1.hookPendingOrderPlaced)({
        symbol: symbol.toUpperCase(),
        side,
        timeframe,
        entry,
        stopLoss,
        takeProfit,
        sizeQty: normalizedSizeQty,
        sizeUsd: effectiveSizeUsd,
        accountBalance: balance,
        orderId,
        binanceOrderId,
    });
    {
        const { recordPipelineEvent } = await Promise.resolve().then(() => __importStar(require('../repositories/testnet.repository')));
        await recordPipelineEvent('pending_order_linked', {
            order_id: orderId,
            binance_order_id: binanceOrderId,
            decision_id: decisionRecordId,
            symbol: symbol.toUpperCase(),
            timeframe,
            execution_risk: risk,
        });
    }
    return {
        success: true,
        orderId,
        binanceOrderId,
        reason: levelAdjustment
            ? `Pending limit order created (${timeframe}); minimum-lot stop normalized`
            : `Pending limit order created (${timeframe})`,
        levelAdjustment,
    };
}

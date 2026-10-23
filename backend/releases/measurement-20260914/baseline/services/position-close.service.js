"use strict";
/**
 * Close local testnet positions and optionally mirror closes on Binance.
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
exports.hasBinanceFillProof = exports.PROTECTIVE_CLOSE_REASON = void 0;
exports.calculatePnl = calculatePnl;
exports.closeDuplicateForMerge = closeDuplicateForMerge;
exports.findOpenPositionByBinanceOrderId = findOpenPositionByBinanceOrderId;
exports.closeLocalPosition = closeLocalPosition;
exports.closePositionOnBinanceMarket = closePositionOnBinanceMarket;
exports.closeOpenPositionFromBinanceFill = closeOpenPositionFromBinanceFill;
exports.syncClosedPositionsFromAccountUpdate = syncClosedPositionsFromAccountUpdate;
/** Close reasons when protective SL/TP placement fails or price already past levels. */
exports.PROTECTIVE_CLOSE_REASON = {
    SL_BREACHED: 'protective_sl_breached_market',
    TP_REACHED: 'protective_tp_reached_market',
    FAILED: 'protective_failed_market_close',
};
const prisma_1 = require("../lib/prisma");
const testnet_repository_1 = require("../repositories/testnet.repository");
const binance_hedge_mode_1 = require("./binance-hedge-mode");
const binanceClient_1 = require("./binanceClient");
const binance_balance_sync_service_1 = require("./binance-balance-sync.service");
const trade_outcome_service_1 = require("./trade-outcome.service");
const binanceClient_2 = require("./binanceClient");
const account_risk_guard_service_1 = require("./account-risk-guard.service");
const binance_fill_pnl_service_1 = require("./binance-fill-pnl.service");
const close_reason_resolve_service_1 = require("./close-reason-resolve.service");
const binance_fill_proof_1 = require("../utils/binance-fill-proof");
const bookkeeping_close_1 = require("../utils/bookkeeping-close");
var binance_fill_proof_2 = require("../utils/binance-fill-proof");
Object.defineProperty(exports, "hasBinanceFillProof", { enumerable: true, get: function () { return binance_fill_proof_2.hasBinanceFillProof; } });
function calculatePnl(side, entry, close, qty) {
    const raw = (close - entry) * Math.abs(qty);
    const isLong = side.toLowerCase() === 'long' || side.toLowerCase() === 'buy';
    return isLong ? raw : -raw;
}
/**
 * Close duplicate DB row when consolidating exposure (records PnL + outcome).
 */
async function closeDuplicateForMerge(positionId, primaryPositionId) {
    const full = await prisma_1.prisma.testnetPosition.findUnique({
        where: { position_id: positionId },
        include: { account: true },
    });
    if (!full || full.status !== 'open' || !full.account) {
        return;
    }
    const closePrice = full.current_price > 0 ? full.current_price : full.entry_price;
    await closeLocalPosition({
        ...full,
        account: { current_balance: full.account.current_balance },
    }, closePrice, `merged_into_${primaryPositionId}`, { merged_into: primaryPositionId });
}
async function findOpenPositionByBinanceOrderId(binanceOrderId) {
    return prisma_1.prisma.testnetPosition.findFirst({
        where: {
            status: 'open',
            OR: [
                { binance_order_id: binanceOrderId },
                { binance_sl_order_id: binanceOrderId },
                { binance_tp_order_id: binanceOrderId },
            ],
        },
        include: { account: true },
    });
}
/**
 * Close DB position, update account stats, record event.
 */
async function closeLocalPosition(position, closePrice, closeReason, eventMeta) {
    if (position.status === 'closed') {
        console.warn(`[PositionClose] ${position.position_id} already closed — skip`);
        return 0;
    }
    const hasFillProof = (0, binance_fill_proof_1.hasBinanceFillProof)(position);
    const isBookkeepingClose = !hasFillProof &&
        (eventMeta?.bookkeeping_close === true ||
            eventMeta?.stale_ghost === true ||
            closeReason === 'reconciliation_closed_not_on_binance' ||
            (0, bookkeeping_close_1.isBookkeepingCloseReason)(closeReason));
    const needsBinanceProof = closeReason === 'stop_loss' || closeReason === 'take_profit';
    if (needsBinanceProof && process.env.BINANCE_ENABLED === 'true') {
        const hasProof = typeof eventMeta?.binance_order_id === 'string' ||
            eventMeta?.verified_binance_zero === true;
        if (!hasProof) {
            console.warn(`[PositionClose] Block unverified ${closeReason} close for ${position.position_id} — require Binance fill or verified zero`);
            return 0;
        }
    }
    const qty = Math.abs(position.size_qty);
    let finalClosePrice = closePrice;
    let realizedPnl = 0;
    let finalCloseReason = closeReason;
    let fillVerified = false;
    let fillSource;
    let fillTradeIds = [];
    let fillCloseQty = qty;
    let entryFee = position.entry_fee ?? 0;
    let exitFee = position.exit_fee ?? 0;
    let fundingFee = position.funding_fee ?? 0;
    if (isBookkeepingClose) {
        finalCloseReason = 'reconciliation_bookkeeping';
        realizedPnl = 0;
    }
    else {
        const fill = await (0, binance_fill_pnl_service_1.resolveClosePnlFromUserTrades)({
            symbol: position.symbol ?? 'BTC',
            side: position.side,
            entryTime: position.entry_time ?? new Date(Date.now() - 3_600_000),
            closeTime: new Date(),
            entryOrderId: position.binance_order_id ?? null,
            sizeQty: position.size_qty,
            entryPrice: position.entry_price,
            fallbackClosePrice: closePrice,
        });
        finalClosePrice = fill.verified ? fill.closePrice : closePrice;
        realizedPnl = fill.verified
            ? fill.realizedPnl
            : process.env.BINANCE_ENABLED === 'true' ? 0 : calculatePnl(position.side, position.entry_price, finalClosePrice, qty);
        finalCloseReason = fill.verified
            ? (0, close_reason_resolve_service_1.resolveVerifiedCloseReason)(closeReason, eventMeta, position)
            : closeReason;
        fillVerified = fill.verified;
        fillSource = fill.source;
        fillTradeIds = fill.tradeIds;
        fillCloseQty = fill.closeQty || qty;
        if (fill.verified) {
            entryFee = fill.entryFee ?? 0;
            exitFee = fill.exitFee ?? 0;
            fundingFee = fill.fundingFee ?? 0;
        }
    }
    await (0, testnet_repository_1.closeTestnetPosition)(position.position_id, finalClosePrice, finalCloseReason);
    await (0, testnet_repository_1.updateTestnetPosition)(position.position_id, {
        current_price: finalClosePrice,
        realized_pnl: realizedPnl,
        entry_fee: entryFee, exit_fee: exitFee, funding_fee: fundingFee,
        unrealized_pnl: 0,
    });
    if (!isBookkeepingClose && (fillVerified || process.env.BINANCE_ENABLED !== 'true')) {
        const isWin = realizedPnl > 0.01;
        const isLoss = realizedPnl < -0.01;
        const accountUpdate = {
            unrealized_pnl: 0,
            total_trades: { increment: 1 },
            consecutive_losses: isLoss ? { increment: 1 } : 0,
            last_trade_time: new Date(),
            updated_at: new Date(),
        };
        // Breakeven (PnL=0) is not a win or loss for streak/cooldown — only real PnL moves stats.
        if (isWin || isLoss) {
            const localBalance = position.account.current_balance + realizedPnl;
            accountUpdate.current_balance = localBalance;
            accountUpdate.equity = localBalance;
            accountUpdate.realized_pnl = { increment: realizedPnl };
            accountUpdate.total_trades = { increment: 1 };
            accountUpdate.winning_trades = { increment: isWin ? 1 : 0 };
            accountUpdate.losing_trades = { increment: isLoss ? 1 : 0 };
            accountUpdate.consecutive_losses = isWin ? 0 : { increment: 1 };
        }
        await prisma_1.prisma.testnetAccount.update({
            where: { id: position.account_id },
            data: accountUpdate,
        });
    }
    if (process.env.BINANCE_ENABLED === 'true') {
        try {
            await (0, binance_balance_sync_service_1.syncTestnetAccountFromBinance)(position.account_id);
        }
        catch (syncErr) {
            const msg = syncErr instanceof Error ? syncErr.message : String(syncErr);
            console.warn(`[PositionClose] Binance balance sync before notify failed: ${msg}`);
        }
    }
    const balances = await (0, binance_balance_sync_service_1.resolveTestnetAccountBalances)(position.account_id, false);
    await (0, testnet_repository_1.recordTestnetTradeEvent)(position.position_id, 'position_closed', {
        symbol: position.symbol ?? 'BTC',
        side: position.side,
        entry_price: position.entry_price,
        size_qty: qty,
        size_usd: qty * finalClosePrice,
        close_price: finalClosePrice,
        close_reason: finalCloseReason,
        realized_pnl: realizedPnl,
        account_balance: balances.account_balance,
        account_equity: balances.account_equity,
        fill_verified: fillVerified,
        fill_source: fillSource,
        binance_fill_ids: fillVerified && !isBookkeepingClose ? fillTradeIds : [],
        close_qty: fillVerified && !isBookkeepingClose ? fillCloseQty : qty,
        ...(isBookkeepingClose ? { suppress_telegram: true, bookkeeping_close: true } : {}),
        ...eventMeta,
    });
    console.log(`[PositionClose] Closed ${position.position_id} @ ${finalClosePrice.toFixed(2)} (${finalCloseReason}) ` +
        `PnL=${realizedPnl.toFixed(2)}` +
        (isBookkeepingClose ? ' [bookkeeping]' : ` fill=${fillSource ?? 'n/a'} verified=${fillVerified}`));
    if (isBookkeepingClose || (process.env.BINANCE_ENABLED === 'true' && !fillVerified)) {
        return realizedPnl;
    }
    const isLoss = realizedPnl < 0;
    const outcomeCtx = {
        position_id: position.position_id,
        symbol: position.symbol ?? 'BTC',
        side: position.side,
        entry_price: position.entry_price,
        entry_time: position.entry_time ?? new Date(),
        stop_loss: position.stop_loss ?? position.entry_price,
        take_profit: position.take_profit ?? position.entry_price,
        expected_rr: position.expected_rr ?? 0,
        risk_usd: position.risk_usd ?? 0,
        entry_fee: entryFee,
        exit_fee: exitFee,
        funding_fee: fundingFee,
        close_reason: finalCloseReason,
        decision_id: typeof eventMeta?.decision_id === 'number' ? eventMeta.decision_id : undefined,
        fill_verified: fillVerified,
    };
    await (0, trade_outcome_service_1.recordTradeOutcomeOnClose)(outcomeCtx, finalClosePrice, realizedPnl, {
        skipReflection: !fillVerified,
    });
    if (isLoss) {
        await (0, account_risk_guard_service_1.applyConsecutiveLossCooldownIfNeeded)(position.account_id, position.symbol ?? 'BTC');
    }
    return realizedPnl;
}
async function closePositionOnBinanceMarket(position, closeQty, options) {
    if (process.env.BINANCE_ENABLED !== 'true') {
        return { ok: true, reason: 'binance_disabled' };
    }
    if (!options?.bypassLifecycleGuard) {
        const { shouldDeferEmergencyMarketClose } = await Promise.resolve().then(() => __importStar(require('./position-lifecycle-guard.service')));
        const defer = await shouldDeferEmergencyMarketClose({
            symbol: position.symbol,
            side: position.side,
            source: options?.guardSource ?? 'closePositionOnBinanceMarket',
            positionId: options?.positionId,
            entryTime: options?.entryTime,
        });
        if (defer.defer) {
            return {
                ok: false,
                reason: `lifecycle_guard: ${defer.reason ?? 'deferred'}`,
            };
        }
    }
    await (0, binance_hedge_mode_1.ensurePositionModeDetected)();
    const qty = Math.abs(closeQty ?? position.size_qty);
    if (qty <= 0) {
        return { ok: false, reason: 'close quantity <= 0' };
    }
    const symbol = `${position.symbol.toUpperCase()}USDT`;
    const qtyCheck = await (0, binanceClient_1.normalizeQuantityForSymbol)(symbol, qty);
    if (!qtyCheck.valid) {
        return { ok: false, reason: qtyCheck.reason ?? 'invalid close quantity after normalization' };
    }
    const normalizedQty = qtyCheck.normalizedQty;
    const isLong = position.side.toLowerCase() === 'long';
    const binanceSide = isLong ? 'SELL' : 'BUY';
    const mode = (0, binance_hedge_mode_1.getPositionMode)();
    const currentPosition = {
        positionAmt: isLong ? normalizedQty : -normalizedQty,
        ...(mode === 'HEDGE'
            ? { positionSide: isLong ? 'LONG' : 'SHORT' }
            : {}),
    };
    try {
        await (0, binanceClient_1.placeMarketOrder)({}, symbol, binanceSide, normalizedQty, 'CLOSE', currentPosition, null);
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { ok: false, reason };
    }
    console.log(`[PositionClose] Binance market close ${symbol} ${binanceSide} qty=${normalizedQty} (raw ${qty})`);
    if (!options?.bypassLifecycleGuard) {
        const emergencySources = new Set([
            'protective_exposure_audit',
            'protective_failed_market_close',
            'position_monitor_unhedged',
        ]);
        if (options?.guardSource && emergencySources.has(options.guardSource)) {
            const { noteEmergencyMarketClose } = await Promise.resolve().then(() => __importStar(require('./position-lifecycle-guard.service')));
            noteEmergencyMarketClose(position.symbol, position.side, options.guardSource);
        }
    }
    return { ok: true, normalizedQty };
}
async function closeOpenPositionFromBinanceFill(binanceOrderId, orderType, executedQty, avgPrice, _symbolUsdt) {
    if (avgPrice <= 0 || executedQty <= 0)
        return false;
    const position = await findOpenPositionByBinanceOrderId(binanceOrderId);
    if (!position) {
        console.warn(`[PositionClose] No open position matched binance order ${binanceOrderId} — skip phantom close`);
        return false;
    }
    const closeReason = orderType === 'TAKE_PROFIT_MARKET' || orderType === 'TAKE_PROFIT'
        ? 'take_profit'
        : orderType === 'STOP_MARKET' || orderType === 'STOP'
            ? 'stop_loss'
            : 'binance_close';
    await closeLocalPosition(position, avgPrice, closeReason, {
        binance_order_id: binanceOrderId,
        order_type: orderType,
        executed_qty: executedQty,
    });
    return true;
}
/**
 * Sync ACCOUNT_UPDATE when Binance reports zero position amount.
 */
async function syncClosedPositionsFromAccountUpdate(positions) {
    if (!positions?.length)
        return;
    for (const p of positions) {
        const amt = parseFloat(p.pa ?? '0');
        if (Math.abs(amt) > 1e-8)
            continue;
        const symbol = (p.s ?? '').replace('USDT', '');
        const ps = (p.ps ?? '').toLowerCase();
        const side = ps === 'long' ? 'long' : ps === 'short' ? 'short' : null;
        if (!symbol || !side)
            continue;
        const open = await prisma_1.prisma.testnetPosition.findFirst({
            where: { status: 'open', symbol, side },
            include: { account: true },
        });
        if (!open)
            continue;
        if (process.env.BINANCE_ENABLED === 'true') {
            try {
                const risks = await (0, binanceClient_2.getPositionRisk)({}, `${symbol}USDT`);
                const live = risks.find((r) => String(r.positionSide).toUpperCase() === (side === 'long' ? 'LONG' : 'SHORT'));
                const liveAmt = Math.abs(parseFloat(live?.positionAmt ?? '0'));
                if (liveAmt > 1e-8) {
                    console.warn(`[PositionClose] ACCOUNT_UPDATE zero ${symbol} ${side} but Binance still has ${liveAmt} — skip DB close`);
                    continue;
                }
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`[PositionClose] Binance verify failed for ${symbol} ${side}: ${msg} — skip close`);
                continue;
            }
        }
        const mark = open.current_price > 0 ? open.current_price : open.entry_price;
        await closeLocalPosition(open, mark, 'account_update_zero_position', {
            binance_position_side: ps,
            verified_binance_zero: true,
        });
    }
}
//# sourceMappingURL=position-close.service.js.map
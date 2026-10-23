"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncTestnetForSymbol = syncTestnetForSymbol;
const crypto_1 = require("crypto");
const prisma_1 = require("../lib/prisma");
const testnet_repository_1 = require("../repositories/testnet.repository");
const position_mark_1 = require("./position-mark");
const position_mark_persist_1 = require("../utils/position-mark-persist");
function shouldTriggerPendingOrder(side, entryPrice, currentPrice, candle) {
    if ((0, position_mark_1.isLongSide)(side)) {
        return candle.low <= entryPrice || currentPrice <= entryPrice;
    }
    return candle.high >= entryPrice || currentPrice >= entryPrice;
}
async function executeTriggeredPendingOrders(symbol, candle) {
    const pendingOrders = await (0, testnet_repository_1.getTestnetPendingOrders)({ symbol, status: 'pending' });
    for (const order of pendingOrders) {
        const triggered = shouldTriggerPendingOrder(order.side, order.entry_price, candle.price, candle);
        if (!triggered) {
            continue;
        }
        const positionId = (0, crypto_1.randomUUID)();
        const createdPosition = await (0, testnet_repository_1.createTestnetPosition)({
            positionId,
            accountId: order.account_id,
            symbol,
            side: order.side,
            entryPrice: order.entry_price,
            stopLoss: order.stop_loss,
            takeProfit: order.take_profit,
            sizeUsd: order.size_usd,
            sizeQty: order.size_qty,
            riskUsd: order.risk_usd,
            riskPercent: order.risk_percent,
            expectedRr: order.expected_rr,
            linkedPredictionId: order.linked_prediction_id ?? undefined,
            binanceOrderId: order.binance_order_id ?? undefined,
            binanceSlOrderId: undefined,
            binanceTpOrderId: undefined,
            tpLevels: undefined,
            tpHitCount: 0,
            partialClosed: 0,
            entryFee: 0,
        });
        await (0, testnet_repository_1.executeTestnetPendingOrder)(order.order_id, positionId);
        await (0, testnet_repository_1.recordTestnetTradeEvent)(createdPosition.position_id, 'pending_order_executed', {
            order_id: order.order_id,
            entry_price: order.entry_price,
        });
    }
}
/** Update mark price and unrealized PnL only (safe when Binance is source of truth for fills). */
async function syncOpenPositionMarks(symbol, candle) {
    const openPositions = await (0, testnet_repository_1.getTestnetPositions)({ symbol, status: 'open' });
    for (const position of openPositions) {
        const unrealizedPnl = (0, position_mark_1.calculateUnrealizedPnl)(position.side, position.entry_price, candle.price, position.size_qty);
        const storedMark = position.current_price || position.entry_price;
        const storedUnrealized = position.unrealized_pnl || 0;
        if (!(0, position_mark_persist_1.shouldPersistPositionMark)(position.position_id, candle.price, storedMark, unrealizedPnl, storedUnrealized)) {
            continue;
        }
        await (0, testnet_repository_1.updateTestnetPosition)(position.position_id, {
            current_price: candle.price,
            unrealized_pnl: unrealizedPnl,
        });
        (0, position_mark_persist_1.notePositionMarkPersisted)(position.position_id);
    }
}
/**
 * Paper-trading only: close on candle SL/TP touch without Binance.
 * Must NOT run when BINANCE_ENABLED=true — otherwise DB shows closed while Binance position stays open.
 */
async function simulatePaperSlTpOnCandle(symbol, candle) {
    const openPositions = await (0, testnet_repository_1.getTestnetPositions)({ symbol, status: 'open' });
    for (const position of openPositions) {
        const slHit = (0, position_mark_1.isLongSide)(position.side)
            ? candle.low <= position.stop_loss
            : candle.high >= position.stop_loss;
        const tpHit = (0, position_mark_1.isLongSide)(position.side)
            ? candle.high >= position.take_profit
            : candle.low <= position.take_profit;
        if (!slHit && !tpHit) {
            continue;
        }
        const closeReason = slHit ? 'stop_loss' : 'take_profit';
        const closePrice = slHit ? position.stop_loss : position.take_profit;
        const realizedPnl = (0, position_mark_1.calculateUnrealizedPnl)(position.side, position.entry_price, closePrice, position.size_qty);
        const rrDenominator = position.risk_usd || 1;
        await (0, testnet_repository_1.closeTestnetPosition)(position.position_id, closePrice, closeReason);
        await (0, testnet_repository_1.updateTestnetPosition)(position.position_id, {
            realized_pnl: realizedPnl,
            unrealized_pnl: 0,
            current_price: closePrice,
            exit_fee: 0,
            funding_fee: 0,
        });
        const account = await prisma_1.prisma.testnetAccount.findUnique({ where: { id: position.account_id } });
        if (account) {
            const newBalance = account.current_balance + realizedPnl;
            await (0, testnet_repository_1.updateTestnetAccountBalance)(account.id, newBalance, realizedPnl);
            await (0, testnet_repository_1.updateTestnetAccountStats)(account.id, realizedPnl > 0);
        }
        const updatedAccount = await prisma_1.prisma.testnetAccount.findUnique({
            where: { id: position.account_id },
        });
        await (0, testnet_repository_1.recordTestnetTradeEvent)(position.position_id, 'position_closed', {
            symbol: position.symbol,
            side: position.side,
            entry_price: position.entry_price,
            size_qty: position.size_qty,
            size_usd: position.size_usd,
            reason: closeReason,
            close_price: closePrice,
            close_reason: closeReason,
            realized_pnl: realizedPnl,
            account_balance: updatedAccount?.current_balance,
            account_equity: updatedAccount?.equity,
            r_multiple: realizedPnl / rrDenominator,
            source: 'paper_candle_simulation',
        });
    }
}
async function syncTestnetForSymbol(symbol, candle) {
    if (process.env.BINANCE_ENABLED === 'true') {
        await syncOpenPositionMarks(symbol, candle);
        return;
    }
    await executeTriggeredPendingOrders(symbol, candle);
    await syncOpenPositionMarks(symbol, candle);
    await simulatePaperSlTpOnCandle(symbol, candle);
}
//# sourceMappingURL=testnet-sync.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hookPendingOrderPlaced = hookPendingOrderPlaced;
exports.hookPendingCancelled = hookPendingCancelled;
const telegram_notify_service_1 = require("./telegram-notify.service");
/** Testnet: limit pending placed (open path). */
function hookPendingOrderPlaced(input) {
    (0, telegram_notify_service_1.notifyTrade)({
        title: '📥 Đặt lệnh chờ (limit)',
        symbol: input.symbol,
        side: input.side,
        timeframe: input.timeframe,
        entry: input.entry,
        stopLoss: input.stopLoss,
        takeProfit: input.takeProfit,
        sizeQty: input.sizeQty,
        sizeUsd: input.sizeUsd,
        accountBalance: input.accountBalance,
        extra: {
            order_id: input.orderId,
            binance_order_id: input.binanceOrderId,
        },
    }, `pending:${input.binanceOrderId || input.orderId}`);
}
/** Testnet: pending order cancelled before fill. */
function hookPendingCancelled(symbol, orderId, reason) {
    (0, telegram_notify_service_1.notifyTrade)({
        title: '⚪ Hủy lệnh chờ',
        symbol,
        reason: reason || 'cancelled',
        extra: { order_id: orderId },
    }, `cancel_pending:${orderId}`);
}
//# sourceMappingURL=telegram-hooks.js.map
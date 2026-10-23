"use strict";
/**
 * Map verified Binance fills to close_reason taxonomy (binance_sl/tp/market).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveVerifiedCloseReason = resolveVerifiedCloseReason;
function resolveVerifiedCloseReason(closeReason, eventMeta, position) {
    const needsMap = closeReason.startsWith('reconciliation') ||
        closeReason === 'account_update_zero_position' ||
        closeReason === 'backfill_pnl' ||
        closeReason === 'binance_close';
    if (!needsMap) {
        if (closeReason === 'take_profit')
            return 'binance_tp';
        if (closeReason === 'stop_loss')
            return 'binance_sl';
        return closeReason;
    }
    const orderType = String(eventMeta?.order_type ?? '').toUpperCase();
    if (orderType.includes('TAKE_PROFIT'))
        return 'binance_tp';
    if (orderType.includes('STOP'))
        return 'binance_sl';
    if (orderType === 'MARKET' || orderType === 'LIMIT')
        return 'binance_market';
    const binanceOrderId = eventMeta?.binance_order_id != null ? String(eventMeta.binance_order_id) : null;
    if (binanceOrderId && position) {
        if (position.binance_sl_order_id === binanceOrderId)
            return 'binance_sl';
        if (position.binance_tp_order_id === binanceOrderId)
            return 'binance_tp';
    }
    if (closeReason === 'take_profit')
        return 'binance_tp';
    if (closeReason === 'stop_loss')
        return 'binance_sl';
    return 'reconciliation_fill';
}
//# sourceMappingURL=close-reason-resolve.service.js.map
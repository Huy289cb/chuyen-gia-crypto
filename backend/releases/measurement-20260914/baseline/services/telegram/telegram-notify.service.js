"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setTelegramRealtimeMuted = setTelegramRealtimeMuted;
exports.isTelegramRealtimeMuted = isTelegramRealtimeMuted;
exports.notifyTrade = notifyTrade;
exports.notifyAlert = notifyAlert;
exports.notifyVerbose = notifyVerbose;
exports.notifyFromTradeEvent = notifyFromTradeEvent;
const telegram_1 = require("../../config/telegram");
const telegram_client_1 = require("./telegram-client");
const message_formatters_1 = require("./message-formatters");
const dedupCache = new Map();
const DEDUP_TTL_MS = 60_000;
const VERBOSE_DEBOUNCE_MS = 5 * 60_000;
let realtimeMuted = false;
function setTelegramRealtimeMuted(muted) {
    realtimeMuted = muted;
}
function isTelegramRealtimeMuted() {
    return realtimeMuted;
}
function shouldDedup(key, ttlMs) {
    const now = Date.now();
    const prev = dedupCache.get(key);
    if (prev != null && now - prev < ttlMs)
        return true;
    dedupCache.set(key, now);
    if (dedupCache.size > 500) {
        for (const [k, t] of dedupCache) {
            if (now - t > ttlMs)
                dedupCache.delete(k);
        }
    }
    return false;
}
function notifyTrade(payload, dedupKey) {
    if (!(0, telegram_1.isTelegramEnabled)() || realtimeMuted || !(0, telegram_1.shouldNotifyTrades)())
        return;
    const key = dedupKey || `trade:${payload.title}:${payload.symbol}:${payload.reason}`;
    if (shouldDedup(key, DEDUP_TTL_MS))
        return;
    (0, telegram_client_1.enqueueTelegramMessage)((0, message_formatters_1.formatTradeNotify)(payload));
}
function notifyAlert(title, body, dedupKey, debounceMs = DEDUP_TTL_MS) {
    if (!(0, telegram_1.isTelegramEnabled)() || realtimeMuted)
        return;
    if (!(0, telegram_1.shouldNotifyRisk)() && !(0, telegram_1.shouldNotifyVerbose)())
        return;
    const key = dedupKey || `alert:${title}:${body.slice(0, 80)}`;
    if (shouldDedup(key, debounceMs))
        return;
    (0, telegram_client_1.enqueueTelegramMessage)((0, message_formatters_1.formatAlert)(title, body));
}
function notifyVerbose(title, body, dedupKey) {
    if (!(0, telegram_1.isTelegramEnabled)() || realtimeMuted || !(0, telegram_1.shouldNotifyVerbose)())
        return;
    const key = dedupKey || `verbose:${title}:${body.slice(0, 80)}`;
    if (shouldDedup(key, VERBOSE_DEBOUNCE_MS))
        return;
    (0, telegram_client_1.enqueueTelegramMessage)((0, message_formatters_1.formatAlert)(title, body));
}
function notifyFromTradeEvent(eventType, eventData, positionId) {
    if (eventData?.reconciliation_backfill === true) {
        return;
    }
    const d = eventData || {};
    // Partial fills are internal progress — user only needs the final open notification.
    if (eventType === 'partial_fill') {
        return;
    }
    // Bookkeeping / reconciliation closes (PnL=0, no wallet change) are pure
    // internal DB sync — nothing the user needs to act on, so stay silent.
    if (d.suppress_telegram === true) {
        return;
    }
    if (eventType === 'protective_failed' && d.action === 'market_close') {
        // position_closed event follows successful emergency close — avoid duplicate Telegram.
        return;
    }
    const title = (0, message_formatters_1.mapTradeEventType)(eventType);
    if (!title)
        return;
    const entry = typeof d.entry_price === 'number'
        ? d.entry_price
        : typeof d.entry === 'number'
            ? d.entry
            : typeof d.avg_price === 'number'
                ? d.avg_price
                : undefined;
    const sizeQty = typeof d.size_qty === 'number'
        ? d.size_qty
        : typeof d.executed_qty === 'number'
            ? d.executed_qty
            : undefined;
    notifyTrade({
        title,
        symbol: d.symbol != null ? String(d.symbol) : d.coin != null ? String(d.coin) : undefined,
        side: d.side != null ? String(d.side) : undefined,
        entry,
        closePrice: typeof d.close_price === 'number' ? d.close_price : undefined,
        stopLoss: typeof d.stop_loss === 'number' ? d.stop_loss : undefined,
        takeProfit: typeof d.take_profit === 'number' ? d.take_profit : undefined,
        sizeQty,
        sizeUsd: typeof d.size_usd === 'number' ? d.size_usd : undefined,
        pnl: typeof d.realized_pnl === 'number'
            ? d.realized_pnl
            : typeof d.pnl === 'number'
                ? d.pnl
                : undefined,
        accountBalance: typeof d.account_balance === 'number'
            ? d.account_balance
            : typeof d.current_balance === 'number'
                ? d.current_balance
                : undefined,
        accountEquity: typeof d.account_equity === 'number'
            ? d.account_equity
            : typeof d.equity === 'number'
                ? d.equity
                : undefined,
        reason: d.close_reason != null
            ? String(d.close_reason)
            : d.reason != null
                ? String(d.reason)
                : undefined,
        extra: {
            position_id: positionId,
            order_id: d.order_id != null ? String(d.order_id) : undefined,
        },
    }, `event:${eventType}:${positionId}:${d.binance_order_id ?? ''}`);
}
//# sourceMappingURL=telegram-notify.service.js.map
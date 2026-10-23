"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.escapeHtml = escapeHtml;
exports.fmtUsd = fmtUsd;
exports.fmtPct = fmtPct;
exports.fmtPrice = fmtPrice;
exports.formatSideLabel = formatSideLabel;
exports.formatTradeNotify = formatTradeNotify;
exports.formatAlert = formatAlert;
exports.statusEmoji = statusEmoji;
exports.schedulerIcon = schedulerIcon;
exports.formatSchedulerCompact = formatSchedulerCompact;
exports.formatStatusSummary = formatStatusSummary;
exports.formatShowSummary = formatShowSummary;
exports.formatPipelineSummary = formatPipelineSummary;
exports.formatOpenPositionForLenh = formatOpenPositionForLenh;
exports.formatEventSummary = formatEventSummary;
exports.mapTradeEventType = mapTradeEventType;
const dateHelpers_1 = require("../../utils/dateHelpers");
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
function fmtUsd(n, digits = 2) {
    if (n == null || !Number.isFinite(n))
        return '—';
    const sign = n >= 0 ? '' : '-';
    return `${sign}$${Math.abs(n).toFixed(digits)}`;
}
function fmtPct(n) {
    if (n == null || !Number.isFinite(n))
        return '—';
    return `${(n * 100).toFixed(2)}%`;
}
function fmtPrice(n) {
    if (n == null || !Number.isFinite(n))
        return '—';
    if (n >= 1000) {
        return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return n.toFixed(4);
}
function formatSideLabel(side) {
    if (!side)
        return undefined;
    const s = side.toLowerCase();
    if (s === 'long' || s === 'buy')
        return 'Long';
    if (s === 'short' || s === 'sell')
        return 'Short';
    return side;
}
function formatTradeNotify(p) {
    const lines = [`<b>${escapeHtml(p.title)}</b>`];
    if (p.symbol)
        lines.push(`Symbol: <b>${escapeHtml(p.symbol)}</b>`);
    const sideLabel = formatSideLabel(p.side);
    if (sideLabel)
        lines.push(`Side: <b>${escapeHtml(sideLabel)}</b>`);
    if (p.timeframe)
        lines.push(`TF: ${escapeHtml(p.timeframe)}`);
    if (p.entry != null)
        lines.push(`Giá mở: ${fmtPrice(p.entry)}`);
    if (p.closePrice != null)
        lines.push(`Giá đóng: ${fmtPrice(p.closePrice)}`);
    if (p.stopLoss != null)
        lines.push(`SL: ${fmtPrice(p.stopLoss)}`);
    if (p.takeProfit != null)
        lines.push(`TP: ${fmtPrice(p.takeProfit)}`);
    if (p.sizeQty != null) {
        const base = p.symbol?.replace(/USDT$/i, '') ?? '';
        const vol = base
            ? `${p.sizeQty} ${base}${p.sizeUsd != null ? ` (~${fmtUsd(p.sizeUsd)})` : ''}`
            : `${p.sizeQty}${p.sizeUsd != null ? ` (~${fmtUsd(p.sizeUsd)})` : ''}`;
        lines.push(`Volume: ${vol}`);
    }
    if (p.pnl != null) {
        const sign = p.pnl >= 0 ? '+' : '';
        lines.push(`PnL: <b>${sign}${fmtUsd(p.pnl)}</b>`);
    }
    if (p.accountBalance != null) {
        lines.push(`Tài khoản: ${fmtUsd(p.accountBalance)}`);
    }
    else if (p.accountEquity != null) {
        lines.push(`Equity: ${fmtUsd(p.accountEquity)}`);
    }
    if (p.reason)
        lines.push(`Lý do: ${escapeHtml(p.reason)}`);
    if (p.extra) {
        for (const [k, v] of Object.entries(p.extra)) {
            if (v == null)
                continue;
            lines.push(`${escapeHtml(k)}: ${escapeHtml(String(v))}`);
        }
    }
    lines.push(`<i>${(0, dateHelpers_1.formatVietnamTime)(new Date())}</i>`);
    return lines.join('\n');
}
function formatAlert(title, body) {
    return `<b>${escapeHtml(title)}</b>\n${escapeHtml(body)}\n<i>${(0, dateHelpers_1.formatVietnamTime)(new Date())}</i>`;
}
function statusEmoji(ok) {
    return ok ? '🟢' : '🔴';
}
function schedulerIcon(status) {
    if (status === 'running')
        return '🟢';
    if (status === 'stale')
        return '🔴';
    return '⚪';
}
function formatSchedulerCompact(s) {
    return `${schedulerIcon(s.status)} ${escapeHtml(s.name)} ${escapeHtml(s.lastRun)}`;
}
function formatStatusSummary(h) {
    const workerOk = h.workerStatus === 'healthy';
    const dbOk = h.databaseStatus === 'healthy';
    const safetyOk = h.safetyValidation === 'passed';
    const staleCount = h.schedulers.filter((s) => s.status === 'stale').length;
    const lines = [
        '<b>Trạng thái hệ thống</b>',
        `${statusEmoji(workerOk)} Worker ${escapeHtml(h.workerStatus)}`,
        `${statusEmoji(dbOk)} DB ${escapeHtml(h.databaseStatus)}`,
        `${statusEmoji(safetyOk)} Safety ${safetyOk ? 'OK' : escapeHtml(h.safetyValidation.slice(0, 40))}`,
        `${statusEmoji(h.warmupOk)} Warmup ${h.warmupOk ? 'OK' : 'THIẾU'}`,
        `${statusEmoji(h.binanceEnabled)} Binance ${h.binanceEnabled ? 'ON' : 'OFF'}`,
        `${statusEmoji(staleCount === 0)} Schedulers${staleCount > 0 ? ` (${staleCount} stale)` : ''}`,
    ];
    if (h.riskLocked) {
        lines.push(`🔒 Cooldown: ${escapeHtml(h.lockReason || 'locked')}`);
    }
    if (h.recentErrors.length > 0) {
        const e = h.recentErrors[0];
        lines.push(`⚠️ ${escapeHtml(e.event_type)}: ${escapeHtml(formatEventSummary(e.event_type, e.summary, 120))}`);
    }
    return lines.join('\n');
}
function formatShowSummary(s) {
    const lines = [
        '<b>Tài khoản</b>',
        `Equity ${fmtUsd(s.equity)} | Balance ${fmtUsd(s.totalBalance)}`,
        `PnL hôm nay: ${fmtUsd(s.dailyPnL)}`,
    ];
    const showTradeDetail = s.tradeStatsSource === 'binance' ||
        (s.tradeStatsSource === 'db' && s.closedCount != null && s.wins != null && s.losses != null);
    if (showTradeDetail && s.closedCount != null && s.wins != null && s.losses != null) {
        lines.push(`Giao dịch hôm nay: ${s.closedCount} (W${s.wins}/L${s.losses})`);
    }
    lines.push(`Vị thế: ${s.openCount} mở, ${s.pendingCount} chờ`, s.riskLocked
        ? `🔒 Cooldown: ${escapeHtml(s.lockReason || 'locked')}`
        : '🟢 Không cooldown', `Notify: ${s.notifyMuted ? 'TẮT' : 'BẬT'}`);
    if (s.topError) {
        lines.push(`⚠️ ${escapeHtml(s.topError.event_type)}: ${escapeHtml(formatEventSummary(s.topError.event_type, s.topError.summary, 120))}`);
    }
    return lines.join('\n');
}
function formatPipelineSummary(p) {
    const lines = ['<b>Pipeline</b>'];
    for (const s of p.schedulers) {
        lines.push(formatSchedulerCompact(s));
    }
    lines.push(`${statusEmoji(p.warmupOk)} Warmup ${p.warmupOk ? 'OK' : 'THIẾU'}`);
    lines.push(`LLM hôm nay: ${p.llmTotal} (${p.llmTrades} trade)`);
    if (p.lastDecision) {
        const reason = p.lastDecision.reason ? ` — ${escapeHtml(p.lastDecision.reason.slice(0, 50))}` : '';
        lines.push(`Quyết định cuối: ${escapeHtml(p.lastDecision.decision)} (${escapeHtml(p.lastDecision.ago)})${reason}`);
    }
    return lines.join('\n');
}
function formatOpenPositionForLenh(p) {
    const sideLabel = p.side === 'long' ? 'LONG' : 'SHORT';
    const tpSl = [];
    if (p.takeProfit != null && p.takeProfit > 0)
        tpSl.push(`TP ${fmtPrice(p.takeProfit)}`);
    if (p.stopLoss != null && p.stopLoss > 0)
        tpSl.push(`SL ${fmtPrice(p.stopLoss)}`);
    const levels = tpSl.length > 0 ? ` | ${tpSl.join(' ')}` : '';
    return (`• ${escapeHtml(p.symbol)} <b>${sideLabel}</b> ${fmtUsd(p.sizeUsd)} | ` +
        `${fmtPrice(p.entry)} → ${fmtPrice(p.mark)}${levels} | PnL ${fmtUsd(p.unrealizedPnl)}`);
}
function formatEventSummary(eventType, summary, maxLen = 120) {
    const raw = summary.trim();
    if (!raw.startsWith('{')) {
        return raw.length > maxLen ? `${raw.slice(0, maxLen)}…` : raw;
    }
    try {
        const d = JSON.parse(raw);
        if (eventType === 'protective_failed') {
            const reason = String(d.reason ?? d.close_reason ?? 'protective');
            const price = typeof d.close_price === 'number' ? ` @ ${fmtPrice(d.close_price)}` : '';
            const action = d.action === 'market_close' ? ' (đóng market)' : '';
            const text = `${reason}${price}${action}`;
            return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
        }
        const reason = d.reason ?? d.close_reason ?? d.message ?? d.close_error;
        if (reason != null) {
            const text = String(reason);
            return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
        }
    }
    catch {
        /* use raw slice below */
    }
    return raw.length > maxLen ? `${raw.slice(0, maxLen)}…` : raw;
}
function mapTradeEventType(eventType) {
    const map = {
        entry_order_filled: '🟢 Mở vị thế (fill)',
        pending_order_executed: '🟢 Mở vị thế (sim)',
        partial_fill: '🟡 Fill một phần',
        position_closed: '🔴 Đóng vị thế',
        position_closed_algo: '🔴 Đóng (SL/TP algo)',
        algo_order_filled: '⚡ Algo order filled',
        pending_order_cancelled: '⚪ Hủy lệnh chờ',
        pending_order_cancelled_ttl: '⚪ Hủy lệnh chờ (hết TTL)',
        pending_order_cancelled_drift: '⚪ Hủy lệnh chờ (lệch giá)',
    };
    return map[eventType] ?? null;
}
//# sourceMappingURL=message-formatters.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDailyReportMessage = buildDailyReportMessage;
exports.sendDailyReport = sendDailyReport;
const ict_time_1 = require("../../utils/ict-time");
const account_summary_service_1 = require("../account-summary.service");
const system_health_service_1 = require("../system-health.service");
const message_formatters_1 = require("./message-formatters");
const telegram_client_1 = require("./telegram-client");
async function buildDailyReportMessage() {
    const { symbol, methodId } = (0, account_summary_service_1.getDefaultTradingScope)();
    const [balance, todayStats, positions, pending, health, llm] = await Promise.all([
        (0, account_summary_service_1.getAccountBalanceSummary)(symbol, methodId, true, true),
        (0, account_summary_service_1.getTodayTradeStatsIct)(symbol, methodId),
        (0, account_summary_service_1.getLiveOpenPositionLines)(symbol, methodId),
        (0, account_summary_service_1.getLivePendingOrderLines)(symbol, methodId),
        (0, system_health_service_1.getSystemHealthSnapshot)(),
        (0, system_health_service_1.getLlmStatsTodayIct)(),
    ]);
    const staleCount = health.schedulers.filter((s) => s.status === 'stale').length;
    const pipelineOk = health.warmup.isWarmedUp && staleCount === 0;
    const lines = [
        `<b>📊 Báo cáo ${(0, message_formatters_1.escapeHtml)((0, ict_time_1.getIctDateString)())}</b>`,
        `${(0, message_formatters_1.escapeHtml)(symbol)} · Equity ${(0, message_formatters_1.fmtUsd)(balance.equity)} · Balance ${(0, message_formatters_1.fmtUsd)(balance.totalBalance)}`,
        '',
        `<b>PnL</b> Hôm nay ${(0, message_formatters_1.fmtUsd)(balance.dailyPnL)} | 7 ngày ${(0, message_formatters_1.fmtUsd)(balance.weeklyPnL)} | Unrealized ${(0, message_formatters_1.fmtUsd)(balance.openUnrealized)}`,
        todayStats.source === 'binance' || todayStats.fromDbPositions
            ? `<b>Giao dịch</b> Đóng ${todayStats.closedCount} (W${todayStats.wins}/L${todayStats.losses}) · Realized ${(0, message_formatters_1.fmtUsd)(todayStats.totalRealizedPnl)}`
            : `<b>Giao dịch</b> Đóng ${todayStats.closedCount}`,
        `<b>Đang mở</b> ${positions.length} vị thế, ${pending.length} lệnh chờ`,
        `<b>LLM</b> ${llm.total} quyết định (${llm.trades} trade)`,
        `${(0, message_formatters_1.statusEmoji)(pipelineOk)} Pipeline ${pipelineOk ? 'OK' : health.warmup.isWarmedUp ? `${staleCount} scheduler stale` : 'warmup thiếu'}`,
    ];
    if (health.risk.isLocked) {
        lines.push(`🔒 ${(0, message_formatters_1.escapeHtml)(health.risk.lockReason || 'Cooldown')}`);
    }
    if (health.recentErrors.length > 0) {
        const e = health.recentErrors[0];
        lines.push(`⚠️ ${(0, message_formatters_1.escapeHtml)(e.event_type)}: ${(0, message_formatters_1.escapeHtml)(e.summary.slice(0, 60))}`);
    }
    return lines.join('\n');
}
async function sendDailyReport() {
    const text = await buildDailyReportMessage();
    (0, telegram_client_1.enqueueTelegramMessage)(text);
}
//# sourceMappingURL=daily-report.js.map
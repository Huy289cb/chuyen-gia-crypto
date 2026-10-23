"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startTelegramBot = startTelegramBot;
exports.stopTelegramBot = stopTelegramBot;
const telegram_1 = require("../../config/telegram");
const telegram_client_1 = require("./telegram-client");
const telegram_client_2 = require("./telegram-client");
const account_summary_service_1 = require("../account-summary.service");
const system_health_service_1 = require("../system-health.service");
const prisma_1 = require("../../lib/prisma");
const message_formatters_1 = require("./message-formatters");
const telegram_notify_service_1 = require("./telegram-notify.service");
const daily_report_1 = require("./daily-report");
const telegram_ai_service_1 = require("./telegram-ai.service");
const cursor_agent_service_1 = require("./cursor-agent.service");
const cursor_chat_service_1 = require("./cursor-chat.service");
let polling = false;
let offset = 0;
let pollTimer = null;
const HELP_TEXT = `<b>Lệnh cơ bản</b>
/show — tài khoản + cooldown
/lenh — lệnh đang mở trên sàn
/pnl — PnL hôm nay / 7 ngày
/pipeline — pipeline tóm tắt
/baocao — báo cáo ngày
/status — trạng thái hệ thống
/sukien — sự kiện gần nhất
/tat · /bat — tắt/bật notify

<b>AI</b> (Groq)
/ai &lt;câu hỏi&gt; — chat với bro
/ai bao cao · /ai hom nay — báo cáo đầy đủ
/ai loi · /ai pipeline · /ai llm · /ai so sanh · /ai cancel

<b>Cursor</b> (đọc repo, admin)
/cursor &lt;câu hỏi&gt; — hỏi gì cũng được
/cursor new · /cursor status · /cursor cancel
/fix &lt;mô tả&gt; — sửa code → PR

<b>Khác</b>
/deploy? · /logs · /help`;
async function handleCommand(chatId, text, userId) {
    const cmd = text.trim().split(/\s+/)[0]?.toLowerCase() || '';
    const { symbol, methodId } = (0, account_summary_service_1.getDefaultTradingScope)();
    switch (cmd) {
        case '/start':
        case '/help':
            (0, telegram_client_2.enqueueTelegramMessage)(HELP_TEXT, chatId);
            return;
        case '/tat':
            (0, telegram_notify_service_1.setTelegramRealtimeMuted)(true);
            (0, telegram_client_2.enqueueTelegramMessage)('🔕 Đã tắt thông báo realtime. Báo cáo 21h vẫn gửi.', chatId);
            return;
        case '/bat':
            (0, telegram_notify_service_1.setTelegramRealtimeMuted)(false);
            (0, telegram_client_2.enqueueTelegramMessage)('🔔 Đã bật thông báo realtime.', chatId);
            return;
        case '/pnl': {
            const b = await (0, account_summary_service_1.getAccountBalanceSummary)(symbol, methodId, true, true);
            const gapNote = b.dbPositionPnlTrusted
                ? ''
                : `\n⚠️ DB positions ${(0, message_formatters_1.fmtUsd)(b.dbPositionPnlSum)} (gap ${(0, message_formatters_1.fmtUsd)(b.dbPositionPnlGap)})`;
            (0, telegram_client_2.enqueueTelegramMessage)(`<b>PnL (wallet)</b>\nAll-time: ${(0, message_formatters_1.fmtUsd)(b.walletPnl)}\nBinance realized: ${(0, message_formatters_1.fmtUsd)(b.binanceRealizedPnl)}` +
                `\nPhí: ${(0, message_formatters_1.fmtUsd)(b.totalFees)} | Funding: ${(0, message_formatters_1.fmtUsd)(b.fundingFees)}` +
                `\nHôm nay (ICT): ${(0, message_formatters_1.fmtUsd)(b.dailyPnL)} | 7d: ${(0, message_formatters_1.fmtUsd)(b.weeklyPnL)}` +
                `\nUnrealized: ${(0, message_formatters_1.fmtUsd)(b.openUnrealized)} | Equity: ${(0, message_formatters_1.fmtUsd)(b.equity)}${gapNote}`, chatId);
            return;
        }
        case '/lenh': {
            const [positions, pending] = await Promise.all([
                (0, account_summary_service_1.getLiveOpenPositionLines)(symbol, methodId),
                (0, account_summary_service_1.getLivePendingOrderLines)(symbol, methodId),
            ]);
            const lines = ['<b>Đang mở (Binance)</b>'];
            if (positions.length === 0)
                lines.push('(không có)');
            for (const p of positions) {
                lines.push((0, message_formatters_1.formatOpenPositionForLenh)(p));
            }
            lines.push('', '<b>Lệnh chờ (Binance)</b>');
            if (pending.length === 0)
                lines.push('(không có)');
            for (const o of pending) {
                const sideLabel = o.side === 'long' ? 'LONG' : 'SHORT';
                lines.push(`• ${(0, message_formatters_1.escapeHtml)(o.symbol)} ${sideLabel} @ ${o.entry.toFixed(0)}`);
            }
            (0, telegram_client_2.enqueueTelegramMessage)(lines.join('\n'), chatId);
            return;
        }
        case '/pipeline': {
            const [health, llm, lastDecision] = await Promise.all([
                (0, system_health_service_1.getSystemHealthSnapshot)(),
                (0, system_health_service_1.getLlmStatsTodayIct)(),
                (0, system_health_service_1.getLastKimDecision)(),
            ]);
            const msg = (0, message_formatters_1.formatPipelineSummary)({
                schedulers: health.schedulers,
                warmupOk: health.warmup.isWarmedUp,
                llmTotal: llm.total,
                llmTrades: llm.trades,
                lastDecision: lastDecision
                    ? {
                        decision: lastDecision.decision,
                        reason: lastDecision.reason,
                        ago: (0, system_health_service_1.formatRelativeAgo)(lastDecision.timestamp),
                    }
                    : undefined,
            });
            (0, telegram_client_2.enqueueTelegramMessage)(msg, chatId);
            return;
        }
        case '/status':
        case '/health': {
            const health = await (0, system_health_service_1.getSystemHealthSnapshot)();
            (0, telegram_client_2.enqueueTelegramMessage)((0, message_formatters_1.formatStatusSummary)({
                workerStatus: health.workerStatus,
                databaseStatus: health.databaseStatus,
                safetyValidation: health.safetyValidation,
                schedulers: health.schedulers,
                warmupOk: health.warmup.isWarmedUp,
                riskLocked: health.risk.isLocked,
                lockReason: health.risk.lockReason,
                binanceEnabled: health.binanceEnabled,
                recentErrors: health.recentErrors,
            }), chatId);
            return;
        }
        case '/show': {
            const [b, health, positions, pending, todayStats] = await Promise.all([
                (0, account_summary_service_1.getAccountBalanceSummary)(symbol, methodId, true, true),
                (0, system_health_service_1.getSystemHealthSnapshot)(),
                (0, account_summary_service_1.getLiveOpenPositionLines)(symbol, methodId),
                (0, account_summary_service_1.getLivePendingOrderLines)(symbol, methodId),
                (0, account_summary_service_1.getTodayTradeStatsIct)(symbol, methodId),
            ]);
            const showTradeStats = todayStats.source === 'binance' || todayStats.fromDbPositions;
            (0, telegram_client_2.enqueueTelegramMessage)((0, message_formatters_1.formatShowSummary)({
                equity: b.equity,
                totalBalance: b.totalBalance,
                dailyPnL: b.dailyPnL,
                openCount: positions.length,
                pendingCount: pending.length,
                closedCount: showTradeStats ? todayStats.closedCount : undefined,
                wins: showTradeStats ? todayStats.wins : undefined,
                losses: showTradeStats ? todayStats.losses : undefined,
                tradeStatsSource: showTradeStats ? todayStats.source : undefined,
                riskLocked: health.risk.isLocked,
                lockReason: health.risk.lockReason,
                notifyMuted: (0, telegram_notify_service_1.isTelegramRealtimeMuted)(),
                topError: health.recentErrors[0],
            }), chatId);
            return;
        }
        case '/sukien': {
            const [events, decisions] = await Promise.all([
                prisma_1.prisma.testnetTradeEvent.findMany({ orderBy: { timestamp: 'desc' }, take: 5 }),
                prisma_1.prisma.tradeDecision.findMany({
                    where: { method_id: methodId },
                    orderBy: { timestamp: 'desc' },
                    take: 3,
                }),
            ]);
            const lines = ['<b>Sự kiện gần đây</b>'];
            for (const e of events) {
                lines.push(`• [${(0, message_formatters_1.escapeHtml)(e.event_type)}] ${e.timestamp.toISOString().slice(11, 16)}`);
            }
            for (const d of decisions) {
                lines.push(`• [${(0, message_formatters_1.escapeHtml)(d.decision)}] ${d.timestamp.toISOString().slice(11, 16)} ${(0, message_formatters_1.escapeHtml)((d.reason || '').slice(0, 40))}`);
            }
            if (events.length === 0 && decisions.length === 0)
                lines.push('(không có)');
            (0, telegram_client_2.enqueueTelegramMessage)(lines.join('\n'), chatId);
            return;
        }
        case '/baocao': {
            const report = await (0, daily_report_1.buildDailyReportMessage)();
            (0, telegram_client_2.enqueueTelegramMessage)(report, chatId);
            return;
        }
        case '/ai': {
            const args = text.replace(/^\/ai\s*/i, '').trim();
            void (0, telegram_ai_service_1.handleAiCommand)(chatId, userId, args);
            return;
        }
        case '/fix': {
            const fixArgs = text.replace(/^\/fix\s*/i, '').trim();
            if (fixArgs.toLowerCase() === 'status') {
                void (0, cursor_agent_service_1.handleFixStatusCommand)(chatId);
            }
            else {
                void (0, cursor_agent_service_1.handleFixCommand)(chatId, userId, fixArgs);
            }
            return;
        }
        case '/cursor': {
            const cursorArgs = text.replace(/^\/cursor\s*/i, '').trim();
            void (0, cursor_chat_service_1.handleCursorCommand)(chatId, userId, cursorArgs);
            return;
        }
        case '/logs': {
            void (0, telegram_ai_service_1.handleLogsCommand)(chatId, userId);
            return;
        }
        default:
            if (cmd.startsWith('/deploy')) {
                (0, telegram_ai_service_1.handleDeployHelpCommand)(chatId);
                return;
            }
            if (cmd.startsWith('/')) {
                (0, telegram_client_2.enqueueTelegramMessage)('Lệnh không hợp lệ. Gõ /help', chatId);
            }
    }
}
function extractCommandText(msg) {
    const raw = msg.text?.trim() || msg.caption?.trim();
    return raw || null;
}
function processUpdate(update) {
    const msg = update.message;
    if (!msg?.chat)
        return;
    const text = extractCommandText(msg);
    if (!text)
        return;
    const chatId = String(msg.chat.id);
    const userId = msg.from?.id;
    if (!(0, telegram_1.isChatAllowed)(chatId) || !(0, telegram_1.isUserAllowed)(userId)) {
        console.warn(`[TelegramBot] Rejected chat=${chatId} user=${userId}`);
        return;
    }
    if (!text.startsWith('/'))
        return;
    handleCommand(chatId, text, userId !== undefined ? String(userId) : undefined).catch((err) => {
        console.error('[TelegramBot] command error:', err);
        (0, telegram_client_2.enqueueTelegramMessage)('Lỗi xử lý lệnh. Thử lại sau.', chatId);
    });
}
async function pollOnce() {
    if (!polling || !(0, telegram_1.isTelegramEnabled)())
        return;
    try {
        const updates = await (0, telegram_client_1.getTelegramUpdates)(offset > 0 ? offset : undefined);
        for (const u of updates) {
            if (u.update_id >= offset)
                offset = u.update_id + 1;
            processUpdate(u);
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[TelegramBot] poll error:', msg);
    }
}
function schedulePoll() {
    if (!polling)
        return;
    pollTimer = setTimeout(async () => {
        await pollOnce();
        schedulePoll();
    }, 100);
}
function startTelegramBot() {
    (0, telegram_1.logTelegramProcessContext)('worker-bot');
    if (!(0, telegram_1.isTelegramEnabled)()) {
        console.log('[TelegramBot] Disabled (TELEGRAM_ENABLED or missing token/chat ids)');
        return;
    }
    if (!(0, telegram_1.isTelegramPollingEnabled)()) {
        console.log('[TelegramBot] Polling OFF (TELEGRAM_POLLING_ENABLED!=true). ' +
            'Outbound notify/sendMessage only; manual getUpdates is free for debug.');
        return;
    }
    if (polling) {
        console.warn(`[TelegramBot] Already polling pid=${process.pid} — skip duplicate start`);
        return;
    }
    void (0, telegram_client_1.deleteTelegramWebhook)().then(() => {
        polling = true;
        console.log(`[TelegramBot] Starting long polling pid=${process.pid} (consumes getUpdates queue)`);
        schedulePoll();
    });
}
function stopTelegramBot() {
    polling = false;
    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
}
//# sourceMappingURL=telegram-bot.service.js.map
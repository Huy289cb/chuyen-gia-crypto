"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startTelegramDailyReportScheduler = startTelegramDailyReportScheduler;
exports.stopTelegramDailyReportScheduler = stopTelegramDailyReportScheduler;
const node_cron_1 = __importDefault(require("node-cron"));
const telegram_1 = require("../config/telegram");
const daily_report_1 = require("../services/telegram/daily-report");
let task = null;
function startTelegramDailyReportScheduler() {
    if (!(0, telegram_1.isTelegramEnabled)())
        return;
    if (task)
        return;
    task = node_cron_1.default.schedule(telegram_1.telegramConfig.dailyReportCron, async () => {
        try {
            console.log('[TelegramDailyReport] Sending daily report...');
            await (0, daily_report_1.sendDailyReport)();
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[TelegramDailyReport] Failed:', msg);
        }
    }, { timezone: telegram_1.telegramConfig.timezone });
    console.log(`[TelegramDailyReport] Scheduled cron="${telegram_1.telegramConfig.dailyReportCron}" tz=${telegram_1.telegramConfig.timezone}`);
}
function stopTelegramDailyReportScheduler() {
    if (task) {
        task.stop();
        task = null;
    }
}
//# sourceMappingURL=telegram-daily-report.scheduler.js.map
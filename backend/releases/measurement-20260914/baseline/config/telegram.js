"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.telegramConfig = void 0;
exports.isTelegramEnabled = isTelegramEnabled;
exports.isTelegramPollingEnabled = isTelegramPollingEnabled;
exports.logTelegramProcessContext = logTelegramProcessContext;
exports.shouldNotifyVerbose = shouldNotifyVerbose;
exports.shouldNotifyTrades = shouldNotifyTrades;
exports.shouldNotifyRisk = shouldNotifyRisk;
exports.validateTelegramConfig = validateTelegramConfig;
exports.isChatAllowed = isChatAllowed;
exports.isUserAllowed = isUserAllowed;
const node_cron_1 = __importDefault(require("node-cron"));
function stripEnvQuotes(s) {
    const t = s.trim();
    if ((t.startsWith('"') && t.endsWith('"')) ||
        (t.startsWith("'") && t.endsWith("'"))) {
        return t.slice(1, -1).trim();
    }
    return t;
}
function parseCsv(value) {
    if (!value?.trim())
        return [];
    return value
        .split(',')
        .map((s) => stripEnvQuotes(s))
        .filter(Boolean);
}
/** PM2/dotenv often truncate `0 21 * * *` to `0` — allow underscore form `0_21_*_*_*`. */
function parseCronExpr(value, fallback) {
    const raw = (value || fallback).trim();
    const normalized = raw.includes('_') ? raw.replace(/_/g, ' ') : raw;
    if (node_cron_1.default.validate(normalized))
        return normalized;
    if (node_cron_1.default.validate(fallback))
        return fallback;
    return normalized;
}
function parseNotifyLevel(value) {
    const v = (value || 'trades_only').toLowerCase();
    if (v === 'off' || v === 'trades_only' || v === 'trades_risk' || v === 'verbose') {
        return v;
    }
    return 'trades_only';
}
exports.telegramConfig = {
    enabled: process.env.TELEGRAM_ENABLED === 'true',
    pollingEnabled: process.env.TELEGRAM_POLLING_ENABLED === 'true',
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatIds: parseCsv(process.env.TELEGRAM_CHAT_IDS),
    allowedUserIds: parseCsv(process.env.TELEGRAM_ALLOWED_USER_IDS),
    notifyLevel: parseNotifyLevel(process.env.TELEGRAM_NOTIFY_LEVEL),
    dailyReportCron: parseCronExpr(process.env.TELEGRAM_DAILY_REPORT_CRON, '0 21 * * *'),
    timezone: 'Asia/Ho_Chi_Minh',
};
function isTelegramEnabled() {
    return exports.telegramConfig.enabled && !!exports.telegramConfig.botToken && exports.telegramConfig.chatIds.length > 0;
}
function isTelegramPollingEnabled() {
    return isTelegramEnabled() && exports.telegramConfig.pollingEnabled;
}
/** Log once per process for ops/debug (pid + role). */
function logTelegramProcessContext(role) {
    if (!exports.telegramConfig.enabled)
        return;
    console.log(`[Telegram] process=${role} pid=${process.pid} polling=${exports.telegramConfig.pollingEnabled} ` +
        `notify=${exports.telegramConfig.notifyLevel} chats=${exports.telegramConfig.chatIds.length}`);
}
function shouldNotifyVerbose() {
    return exports.telegramConfig.notifyLevel === 'verbose';
}
function shouldNotifyTrades() {
    return (exports.telegramConfig.notifyLevel === 'trades_only' ||
        exports.telegramConfig.notifyLevel === 'trades_risk' ||
        exports.telegramConfig.notifyLevel === 'verbose');
}
function shouldNotifyRisk() {
    return exports.telegramConfig.notifyLevel === 'trades_risk' || exports.telegramConfig.notifyLevel === 'verbose';
}
function validateTelegramConfig() {
    if (!exports.telegramConfig.enabled)
        return;
    const errors = [];
    if (!exports.telegramConfig.botToken) {
        errors.push('TELEGRAM_BOT_TOKEN is required when TELEGRAM_ENABLED=true');
    }
    if (exports.telegramConfig.chatIds.length === 0) {
        errors.push('TELEGRAM_CHAT_IDS is required when TELEGRAM_ENABLED=true');
    }
    if (!node_cron_1.default.validate(exports.telegramConfig.dailyReportCron)) {
        errors.push('TELEGRAM_DAILY_REPORT_CRON is invalid');
    }
    if (errors.length > 0) {
        throw new Error(`Invalid Telegram configuration: ${errors.join(', ')}`);
    }
}
function isChatAllowed(chatId) {
    return exports.telegramConfig.chatIds.includes(String(chatId));
}
function isUserAllowed(userId) {
    if (!userId)
        return true;
    if (exports.telegramConfig.allowedUserIds.length === 0)
        return true;
    return exports.telegramConfig.allowedUserIds.includes(String(userId));
}
//# sourceMappingURL=telegram.js.map
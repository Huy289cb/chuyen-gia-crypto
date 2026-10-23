"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cursorChatConfig = exports.cursorAgentConfig = exports.telegramAiConfig = void 0;
exports.isTelegramAiEnabled = isTelegramAiEnabled;
exports.isCursorAgentEnabled = isCursorAgentEnabled;
exports.isCursorChatEnabled = isCursorChatEnabled;
exports.canUseCursorChat = canUseCursorChat;
exports.validateTelegramAiConfig = validateTelegramAiConfig;
exports.validateCursorAgentConfig = validateCursorAgentConfig;
exports.isTelegramAdminUser = isTelegramAdminUser;
const telegram_1 = require("./telegram");
const groq_models_1 = require("./groq-models");
function isProductionEnv() {
    return process.env.NODE_ENV === 'production';
}
function parseIntEnv(value, fallback) {
    const n = parseInt(value || String(fallback), 10);
    return Number.isFinite(n) ? n : fallback;
}
exports.telegramAiConfig = {
    enabled: process.env.TELEGRAM_AI_ENABLED === 'true',
    model: (0, groq_models_1.getGroqTelegramAiModel)(),
    maxTokens: parseIntEnv(process.env.TELEGRAM_AI_MAX_TOKENS, 2048),
    rateLimitPerUserHour: parseIntEnv(process.env.TELEGRAM_AI_RATE_LIMIT_PER_USER_HOUR, 5),
    rateLimitPerChatDay: parseIntEnv(process.env.TELEGRAM_AI_RATE_LIMIT_PER_CHAT_DAY, 30),
    requireAllowedUserIds: isProductionEnv(),
    systemPromptVersion: process.env.TELEGRAM_AI_SYSTEM_PROMPT_VERSION || '3',
};
exports.cursorAgentConfig = {
    enabled: process.env.CURSOR_AGENT_ENABLED === 'true',
    apiKey: process.env.CURSOR_API_KEY || '',
    model: process.env.CURSOR_AGENT_MODEL || 'composer-2.5',
    repoUrl: process.env.CURSOR_AGENT_REPO_URL || '',
    baseBranch: process.env.CURSOR_AGENT_BASE_BRANCH || 'develop',
};
exports.cursorChatConfig = {
    enabled: process.env.CURSOR_CHAT_ENABLED !== 'false',
    model: process.env.CURSOR_CHAT_MODEL || process.env.CURSOR_AGENT_MODEL || 'composer-2.5',
    adminOnly: process.env.CURSOR_CHAT_ADMIN_ONLY !== 'false',
    rateLimitPerUserHour: parseIntEnv(process.env.CURSOR_CHAT_RATE_LIMIT_PER_USER_HOUR, 3),
    sessionTtlMs: parseIntEnv(process.env.CURSOR_CHAT_SESSION_TTL_MS, 24 * 60 * 60 * 1000),
    jobTimeoutMs: parseIntEnv(process.env.CURSOR_CHAT_JOB_TIMEOUT_MS, 300_000),
};
function isTelegramAiEnabled() {
    return exports.telegramAiConfig.enabled;
}
function isCursorAgentEnabled() {
    return exports.cursorAgentConfig.enabled && !!exports.cursorAgentConfig.apiKey && !!exports.cursorAgentConfig.repoUrl;
}
function isCursorChatEnabled() {
    return exports.cursorChatConfig.enabled && isCursorAgentEnabled();
}
function canUseCursorChat(userId) {
    if (!isCursorChatEnabled())
        return false;
    if (!exports.cursorChatConfig.adminOnly)
        return true;
    return isTelegramAdminUser(userId);
}
function validateTelegramAiConfig() {
    if (!exports.telegramAiConfig.enabled)
        return;
    const errors = [];
    if (exports.telegramAiConfig.maxTokens < 256 || exports.telegramAiConfig.maxTokens > 8192) {
        errors.push('TELEGRAM_AI_MAX_TOKENS must be between 256 and 8192');
    }
    if (!Number.isFinite(exports.telegramAiConfig.rateLimitPerUserHour) ||
        exports.telegramAiConfig.rateLimitPerUserHour < 1) {
        errors.push('TELEGRAM_AI_RATE_LIMIT_PER_USER_HOUR must be >= 1');
    }
    if (!Number.isFinite(exports.telegramAiConfig.rateLimitPerChatDay) ||
        exports.telegramAiConfig.rateLimitPerChatDay < 1) {
        errors.push('TELEGRAM_AI_RATE_LIMIT_PER_CHAT_DAY must be >= 1');
    }
    if (exports.telegramAiConfig.requireAllowedUserIds && telegram_1.telegramConfig.allowedUserIds.length === 0) {
        errors.push('TELEGRAM_ALLOWED_USER_IDS is required in production when TELEGRAM_AI_ENABLED=true');
    }
    if (errors.length > 0) {
        throw new Error(`Invalid Telegram AI configuration: ${errors.join(', ')}`);
    }
}
function validateCursorAgentConfig() {
    if (!exports.cursorAgentConfig.enabled)
        return;
    const errors = [];
    if (!exports.cursorAgentConfig.apiKey) {
        errors.push('CURSOR_API_KEY is required when CURSOR_AGENT_ENABLED=true');
    }
    if (!exports.cursorAgentConfig.repoUrl) {
        errors.push('CURSOR_AGENT_REPO_URL is required when CURSOR_AGENT_ENABLED=true');
    }
    if (errors.length > 0) {
        throw new Error(`Invalid Cursor Agent configuration: ${errors.join(', ')}`);
    }
}
/** Admin-only commands (/logs): user must be in TELEGRAM_ALLOWED_USER_IDS when list is set. */
function isTelegramAdminUser(userId) {
    if (!userId)
        return false;
    if (telegram_1.telegramConfig.allowedUserIds.length === 0) {
        return !isProductionEnv();
    }
    return telegram_1.telegramConfig.allowedUserIds.includes(String(userId));
}
//# sourceMappingURL=telegram-ai.js.map
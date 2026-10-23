"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendTelegramMessage = sendTelegramMessage;
exports.enqueueTelegramMessage = enqueueTelegramMessage;
exports.getTelegramUpdates = getTelegramUpdates;
exports.deleteTelegramWebhook = deleteTelegramWebhook;
const axios_1 = __importStar(require("axios"));
const https_1 = __importDefault(require("https"));
const telegram_1 = require("../../config/telegram");
const API_BASE = 'https://api.telegram.org';
/**
 * VPS often has broken IPv6; Node prefers AAAA → ETIMEDOUT to api.telegram.org.
 * Force IPv4 for all Telegram HTTPS calls.
 */
const telegramHttpsAgent = new https_1.default.Agent({ family: 4, keepAlive: true });
let sendQueue = Promise.resolve();
let lastSendAt = 0;
const MIN_SEND_INTERVAL_MS = 1000;
const QUEUE_MAX_ATTEMPTS = 5;
function botUrl(method) {
    return `${API_BASE}/bot${telegram_1.telegramConfig.botToken}/${method}`;
}
function formatTelegramApiError(err) {
    if ((0, axios_1.isAxiosError)(err)) {
        const data = err.response?.data;
        if (data?.description) {
            return data.error_code != null
                ? `${data.description} (code ${data.error_code})`
                : data.description;
        }
        if (err.code)
            return `${err.code}${err.message ? `: ${err.message}` : ''}`;
        if (err.message)
            return err.message;
        return `HTTP ${err.response?.status ?? '?'}`;
    }
    if (err instanceof Error)
        return err.message || err.name;
    return String(err) || 'unknown error';
}
function isHtmlParseError(description) {
    const d = description.toLowerCase();
    return d.includes("can't parse") || d.includes('parse entities') || d.includes('unsupported');
}
async function throttleSend() {
    const wait = Math.max(0, MIN_SEND_INTERVAL_MS - (Date.now() - lastSendAt));
    if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait));
    }
    lastSendAt = Date.now();
}
async function postSendMessage(chatId, text, parseMode) {
    const payload = {
        chat_id: chatId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
        disable_web_page_preview: true,
    };
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            await axios_1.default.post(botUrl('sendMessage'), payload, {
                timeout: 25_000,
                httpsAgent: telegramHttpsAgent,
            });
            return;
        }
        catch (err) {
            lastErr = err;
            const msg = formatTelegramApiError(err);
            const retryable = msg.includes('ETIMEDOUT') ||
                msg.includes('ECONNRESET') ||
                msg.includes('ENOTFOUND') ||
                msg.includes('429');
            if (!retryable || attempt === 2)
                throw err;
            console.warn(`[Telegram] send retry ${attempt}/2 chat=${chatId}: ${msg}`);
            await new Promise((r) => setTimeout(r, 1500));
        }
    }
    throw lastErr;
}
async function sendChunk(chatId, chunk) {
    try {
        await postSendMessage(chatId, chunk, 'HTML');
    }
    catch (err) {
        const desc = formatTelegramApiError(err);
        if (isHtmlParseError(desc)) {
            console.warn(`[Telegram] HTML parse failed chat=${chatId}, retry plain text`);
            await postSendMessage(chatId, chunk);
            return;
        }
        throw err;
    }
}
async function sendTelegramMessage(text, chatId, options) {
    if (!(0, telegram_1.isTelegramEnabled)())
        return false;
    if (!text?.trim()) {
        console.warn('[Telegram] skip empty message');
        return false;
    }
    const parseMode = options?.plainText ? undefined : 'HTML';
    const targets = chatId ? [chatId] : telegram_1.telegramConfig.chatIds;
    let anyOk = false;
    for (const id of targets) {
        try {
            await throttleSend();
            const chunks = splitMessage(text, 4000);
            for (const chunk of chunks) {
                if (parseMode) {
                    await sendChunk(id, chunk);
                }
                else {
                    await postSendMessage(id, chunk);
                }
                if (chunks.length > 1)
                    await throttleSend();
            }
            anyOk = true;
        }
        catch (err) {
            const msg = formatTelegramApiError(err);
            console.error(`[Telegram] sendMessage failed chat=${id}: ${msg}`);
        }
    }
    return anyOk;
}
function splitMessage(text, maxLen) {
    if (text.length <= maxLen)
        return [text];
    const parts = [];
    let rest = text;
    while (rest.length > maxLen) {
        let cut = rest.lastIndexOf('\n', maxLen);
        if (cut < maxLen * 0.5)
            cut = maxLen;
        parts.push(rest.slice(0, cut));
        rest = rest.slice(cut).trimStart();
    }
    if (rest)
        parts.push(rest);
    return parts;
}
function enqueueTelegramMessage(text, chatId, options) {
    sendQueue = sendQueue
        .then(async () => {
        for (let attempt = 1; attempt <= QUEUE_MAX_ATTEMPTS; attempt++) {
            const sent = await sendTelegramMessage(text, chatId, options);
            if (sent)
                return;
            const delayMs = Math.min(60_000, 2_000 * 2 ** (attempt - 1));
            if (attempt === QUEUE_MAX_ATTEMPTS) {
                console.error(`[Telegram] queued send abandoned after ${QUEUE_MAX_ATTEMPTS} attempts`);
                return;
            }
            console.warn(`[Telegram] queued send failed attempt ${attempt}/${QUEUE_MAX_ATTEMPTS}; retry in ${delayMs}ms`);
            await new Promise((r) => setTimeout(r, delayMs));
        }
    })
        .catch((e) => console.error('[Telegram] queue error:', formatTelegramApiError(e)));
}
async function getTelegramUpdates(offset, timeoutSeconds = 25) {
    if (!telegram_1.telegramConfig.botToken)
        return [];
    const params = {
        timeout: timeoutSeconds,
        allowed_updates: ['message'],
    };
    if (offset != null && offset > 0)
        params.offset = offset;
    console.log(`[Telegram] getUpdates START pid=${process.pid} offset=${offset ?? 'none'} timeout=${timeoutSeconds}s`);
    try {
        const res = await axios_1.default.get(botUrl('getUpdates'), {
            params,
            timeout: (timeoutSeconds + 10) * 1000,
            httpsAgent: telegramHttpsAgent,
        });
        const updates = res.data?.result || [];
        console.log(`[Telegram] getUpdates END pid=${process.pid} count=${updates.length}`);
        return updates;
    }
    catch (err) {
        console.error(`[Telegram] getUpdates error: ${formatTelegramApiError(err)}`);
        return [];
    }
}
/** Clear webhook so getUpdates/polling can receive messages. */
async function deleteTelegramWebhook() {
    if (!telegram_1.telegramConfig.botToken)
        return;
    try {
        await axios_1.default.post(botUrl('deleteWebhook'), { drop_pending_updates: false }, { timeout: 15_000, httpsAgent: telegramHttpsAgent });
        console.log(`[Telegram] deleteWebhook ok pid=${process.pid}`);
    }
    catch (err) {
        console.warn(`[Telegram] deleteWebhook failed pid=${process.pid}: ${formatTelegramApiError(err)}`);
    }
}
//# sourceMappingURL=telegram-client.js.map
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAiCommand = handleAiCommand;
exports.runTelegramAiQuery = runTelegramAiQuery;
exports.handleLogsCommand = handleLogsCommand;
exports.handleDeployHelpCommand = handleDeployHelpCommand;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ict_time_1 = require("../../utils/ict-time");
const prisma_1 = require("../../lib/prisma");
const telegram_ai_1 = require("../../config/telegram-ai");
const groq_client_1 = require("../groq-client");
const ai_context_builder_1 = require("./ai-context.builder");
const ai_prompts_1 = require("./ai-prompts");
const ai_job_queue_1 = require("./ai-job-queue");
const telegram_client_1 = require("./telegram-client");
const message_formatters_1 = require("./message-formatters");
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SESSION_TURNS = 5;
const inMemorySessions = new Map();
const userRateTimestamps = new Map();
const chatDayCounts = new Map();
function getSession(chatId) {
    const mem = inMemorySessions.get(chatId);
    if (!mem)
        return undefined;
    if (Date.now() - mem.updatedAt > SESSION_TTL_MS) {
        inMemorySessions.delete(chatId);
        return undefined;
    }
    return mem;
}
async function loadSession(chatId) {
    const mem = getSession(chatId);
    if (mem)
        return mem;
    try {
        const row = await prisma_1.prisma.aiSession.findUnique({ where: { chat_id: chatId } });
        if (!row)
            return undefined;
        if (Date.now() - row.updated_at.getTime() > SESSION_TTL_MS) {
            await prisma_1.prisma.aiSession.delete({ where: { chat_id: chatId } }).catch(() => undefined);
            return undefined;
        }
        const turns = JSON.parse(row.turns_json);
        const session = { turns, updatedAt: row.updated_at.getTime() };
        inMemorySessions.set(chatId, session);
        return session;
    }
    catch {
        return undefined;
    }
}
async function saveSession(chatId, userId, session) {
    inMemorySessions.set(chatId, session);
    try {
        await prisma_1.prisma.aiSession.upsert({
            where: { chat_id: chatId },
            create: {
                chat_id: chatId,
                user_id: userId ?? null,
                turns_json: JSON.stringify(session.turns),
            },
            update: {
                user_id: userId ?? null,
                turns_json: JSON.stringify(session.turns),
            },
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[TelegramAI] session persist failed chat=${chatId}: ${msg}`);
    }
}
function pushSessionTurn(chatId, userId, userQ, assistantA) {
    void loadSession(chatId).then(async (existing) => {
        const turns = [...(existing?.turns ?? [])];
        turns.push({ role: 'user', content: userQ.slice(0, 500) });
        turns.push({ role: 'assistant', content: assistantA.slice(0, 1500) });
        while (turns.length > MAX_SESSION_TURNS * 2) {
            turns.shift();
        }
        await saveSession(chatId, userId, { turns, updatedAt: Date.now() });
    });
}
function checkRateLimit(userId, chatId) {
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    if (userId) {
        const key = userId;
        const timestamps = (userRateTimestamps.get(key) ?? []).filter((t) => t > hourAgo);
        if (timestamps.length >= telegram_ai_1.telegramAiConfig.rateLimitPerUserHour) {
            return `⏳ Rate limit: tối đa ${telegram_ai_1.telegramAiConfig.rateLimitPerUserHour} lần/giờ/user. Thử lại sau.`;
        }
        timestamps.push(now);
        userRateTimestamps.set(key, timestamps);
    }
    const ictDate = (0, ict_time_1.getIctDateString)();
    const chatEntry = chatDayCounts.get(chatId);
    if (!chatEntry || chatEntry.ictDate !== ictDate) {
        chatDayCounts.set(chatId, { ictDate, count: 1 });
    }
    else {
        if (chatEntry.count >= telegram_ai_1.telegramAiConfig.rateLimitPerChatDay) {
            return `⏳ Rate limit: tối đa ${telegram_ai_1.telegramAiConfig.rateLimitPerChatDay} lần/ngày/chat (ICT).`;
        }
        chatEntry.count += 1;
    }
    return null;
}
function sendAiReply(chatId, text) {
    const chunks = (0, ai_context_builder_1.splitMessageForTelegram)(text);
    for (const chunk of chunks) {
        (0, telegram_client_1.enqueueTelegramMessage)((0, message_formatters_1.escapeHtml)(chunk), chatId);
    }
}
async function runAiAnalysis(chatId, userId, scope, question) {
    if ((0, ai_job_queue_1.isAiJobCancelled)(chatId)) {
        (0, telegram_client_1.enqueueTelegramMessage)('❌ Đã hủy phân tích.', chatId);
        return;
    }
    const groq = (0, groq_client_1.createGroqClient)();
    if (!groq) {
        (0, telegram_client_1.enqueueTelegramMessage)('❌ Groq chưa cấu hình (GROQ_API_KEY).', chatId);
        return;
    }
    const bundle = await (0, ai_context_builder_1.buildAiContext)(scope);
    if ((0, ai_job_queue_1.isAiJobCancelled)(chatId)) {
        (0, telegram_client_1.enqueueTelegramMessage)('❌ Đã hủy phân tích.', chatId);
        return;
    }
    const conversational = (0, ai_prompts_1.isConversationalScope)(scope);
    const session = conversational ? await loadSession(chatId) : undefined;
    const contextJson = (0, ai_context_builder_1.contextToJson)(bundle);
    const systemPrompt = (0, ai_prompts_1.getSystemPrompt)(scope);
    const userPrompt = (0, ai_prompts_1.getUserPrompt)(scope, contextJson, question, session?.turns);
    const answer = await groq.completeText({
        systemPrompt,
        userPrompt,
        temperature: conversational ? 0.55 : 0.3,
        maxTokens: conversational
            ? Math.min(telegram_ai_1.telegramAiConfig.maxTokens, 900)
            : telegram_ai_1.telegramAiConfig.maxTokens,
        preferredModels: [telegram_ai_1.telegramAiConfig.model],
    });
    if ((0, ai_job_queue_1.isAiJobCancelled)(chatId)) {
        (0, telegram_client_1.enqueueTelegramMessage)('❌ Đã hủy phân tích.', chatId);
        return;
    }
    sendAiReply(chatId, answer);
    if (conversational && question) {
        pushSessionTurn(chatId, userId, question, answer);
    }
}
async function handleAiCommand(chatId, userId, args) {
    if (!(0, telegram_ai_1.isTelegramAiEnabled)()) {
        (0, telegram_client_1.enqueueTelegramMessage)('AI Q&A chưa bật (TELEGRAM_AI_ENABLED=false).', chatId);
        return;
    }
    const parsed = (0, ai_context_builder_1.parseAiCommandArgs)(args);
    if (parsed.action === 'cancel') {
        const cancelled = (0, ai_job_queue_1.cancelAiJobForChat)(chatId);
        (0, telegram_client_1.enqueueTelegramMessage)(cancelled ? '🛑 Đang hủy job AI (nếu còn chạy).' : 'Không có job AI đang chạy.', chatId);
        return;
    }
    if (parsed.scope === 'freeform' && !parsed.question) {
        (0, telegram_client_1.enqueueTelegramMessage)((0, ai_prompts_1.getConversationalGreeting)(), chatId);
        return;
    }
    const rateError = checkRateLimit(userId, chatId);
    if (rateError) {
        (0, telegram_client_1.enqueueTelegramMessage)(rateError, chatId);
        return;
    }
    const enqueued = (0, ai_job_queue_1.enqueueAiJob)(chatId, userId, parsed.scope, async () => {
        try {
            await runAiAnalysis(chatId, userId, parsed.scope, parsed.question);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[TelegramAI] analysis failed chat=${chatId}: ${msg}`);
            (0, telegram_client_1.enqueueTelegramMessage)(`❌ Lỗi phân tích AI: ${(0, message_formatters_1.escapeHtml)(msg.slice(0, 200))}`, chatId);
        }
    });
    if (!enqueued.ok) {
        (0, telegram_client_1.enqueueTelegramMessage)('⏳ Đang xử lý job AI khác. Dùng /ai cancel để hủy.', chatId);
        return;
    }
    const waitMsg = (0, ai_prompts_1.isConversationalScope)(parsed.scope)
        ? '💬 Đang suy nghĩ...'
        : '🔍 Đang phân tích... (tối đa 60s)';
    (0, telegram_client_1.enqueueTelegramMessage)(waitMsg, chatId);
}
async function runTelegramAiQuery(scope, question) {
    const groq = (0, groq_client_1.createGroqClient)();
    if (!groq) {
        throw new Error('Groq not configured');
    }
    const bundle = await (0, ai_context_builder_1.buildAiContext)(scope);
    const contextJson = (0, ai_context_builder_1.contextToJson)(bundle);
    const systemPrompt = (0, ai_prompts_1.getSystemPrompt)(scope);
    const userPrompt = (0, ai_prompts_1.getUserPrompt)(scope, contextJson, question);
    const conversational = (0, ai_prompts_1.isConversationalScope)(scope);
    const answer = await groq.completeText({
        systemPrompt,
        userPrompt,
        temperature: conversational ? 0.55 : 0.3,
        maxTokens: conversational
            ? Math.min(telegram_ai_1.telegramAiConfig.maxTokens, 900)
            : telegram_ai_1.telegramAiConfig.maxTokens,
        preferredModels: [telegram_ai_1.telegramAiConfig.model],
    });
    return { answer, scope, generatedAt: bundle.meta.generatedAt };
}
const LOG_PATH = path.join(__dirname, '../../../logs/worker-error.log');
async function handleLogsCommand(chatId, userId) {
    if (!(0, telegram_ai_1.isTelegramAdminUser)(userId)) {
        (0, telegram_client_1.enqueueTelegramMessage)('⛔ Lệnh /logs chỉ dành cho admin (TELEGRAM_ALLOWED_USER_IDS).', chatId);
        return;
    }
    try {
        if (!fs.existsSync(LOG_PATH)) {
            (0, telegram_client_1.enqueueTelegramMessage)('Không tìm thấy worker-error.log.', chatId);
            return;
        }
        const content = fs.readFileSync(LOG_PATH, 'utf8');
        const lines = content.split('\n').filter(Boolean);
        const tail = lines.slice(-30).map(ai_context_builder_1.redactSensitiveText).join('\n');
        const msg = tail.length > 0 ? tail : '(log trống)';
        const chunks = (0, ai_context_builder_1.splitMessageForTelegram)(msg, 3800);
        for (const chunk of chunks) {
            (0, telegram_client_1.enqueueTelegramMessage)(`<pre>${(0, message_formatters_1.escapeHtml)(chunk)}</pre>`, chatId);
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        (0, telegram_client_1.enqueueTelegramMessage)(`❌ Không đọc được log: ${(0, message_formatters_1.escapeHtml)(msg)}`, chatId);
    }
}
function handleDeployHelpCommand(chatId) {
    const text = [
        '<b>Deploy thủ công</b>',
        '1. Review + merge PR trên GitHub',
        '2. SSH VPS: cd ~/chuyen-gia-crypto && ./scripts/deploy.sh',
        '3. Kiểm tra: pm2 status && curl -s http://127.0.0.1:3000/health',
        '',
        'Cursor /fix chỉ tạo draft PR — không auto-deploy.',
    ].join('\n');
    (0, telegram_client_1.enqueueTelegramMessage)(text, chatId);
}
//# sourceMappingURL=telegram-ai.service.js.map
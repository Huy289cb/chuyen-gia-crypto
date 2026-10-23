"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleCursorStatusCommand = handleCursorStatusCommand;
exports.handleCursorCommand = handleCursorCommand;
const sdk_1 = require("@cursor/sdk");
const prisma_1 = require("../../lib/prisma");
const telegram_ai_1 = require("../../config/telegram-ai");
const ai_context_builder_1 = require("./ai-context.builder");
const cursor_cloud_options_1 = require("./cursor-cloud-options");
const cursor_job_queue_1 = require("./cursor-job-queue");
const telegram_client_1 = require("./telegram-client");
const message_formatters_1 = require("./message-formatters");
const userRateTimestamps = new Map();
const CURSOR_HELP = `🤖 <b>/cursor</b> — chat với Cursor (đọc repo, hỏi gì cũng được)

• <code>/cursor câu hỏi</code> — hỏi tiếp (nhớ hội thoại ~24h)
• <code>/cursor new</code> — phiên mới
• <code>/cursor status</code> — trạng thái phiên
• <code>/cursor cancel</code> — hủy job đang chạy

Khác <code>/ai</code> (Groq, nhanh): Cursor đọc codebase thật, chậm hơn (1–5 phút).
Khác <code>/fix</code>: không tự tạo PR — chỉ chat. Muốn sửa code → <code>/fix mô tả</code>.`;
function checkCursorRateLimit(userId) {
    if (!userId)
        return null;
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const timestamps = (userRateTimestamps.get(userId) ?? []).filter((t) => t > hourAgo);
    if (timestamps.length >= telegram_ai_1.cursorChatConfig.rateLimitPerUserHour) {
        return `⏳ Cursor chat: tối đa ${telegram_ai_1.cursorChatConfig.rateLimitPerUserHour} lần/giờ. Thử lại sau.`;
    }
    timestamps.push(now);
    userRateTimestamps.set(userId, timestamps);
    return null;
}
function sendCursorReply(chatId, text) {
    const chunks = (0, ai_context_builder_1.splitMessageForTelegram)(text, 3800);
    for (const chunk of chunks) {
        (0, telegram_client_1.enqueueTelegramMessage)(chunk, chatId, { plainText: true });
    }
}
async function loadCursorSession(chatId) {
    const row = await prisma_1.prisma.aiCursorSession.findUnique({ where: { chat_id: chatId } });
    if (!row)
        return null;
    if (Date.now() - row.updated_at.getTime() > telegram_ai_1.cursorChatConfig.sessionTtlMs) {
        await prisma_1.prisma.aiCursorSession.delete({ where: { chat_id: chatId } }).catch(() => undefined);
        return null;
    }
    return { agent_id: row.agent_id, updated_at: row.updated_at };
}
async function saveCursorSession(chatId, userId, agentId) {
    await prisma_1.prisma.aiCursorSession.upsert({
        where: { chat_id: chatId },
        create: {
            chat_id: chatId,
            user_id: userId ?? null,
            agent_id: agentId,
        },
        update: {
            user_id: userId ?? null,
            agent_id: agentId,
        },
    });
}
async function clearCursorSession(chatId) {
    await prisma_1.prisma.aiCursorSession.delete({ where: { chat_id: chatId } }).catch(() => undefined);
}
function buildChatPrompt(userQuestion, isNewSession, opsContext) {
    const parts = [];
    if (isNewSession) {
        parts.push('You are Cursor assistant for the Kim Nghia crypto trading bot (BTC Binance testnet, Node backend).', 'Answer in Vietnamese unless the user uses another language.', 'Default: read-only Q&A — explain code and ops clearly for a non-expert operator.', 'Do NOT commit, push, or open PR unless the user explicitly asks to implement or fix something in the repo.', 'Keep answers concise (Telegram ~4000 char limit). Use short paragraphs or bullets.');
        if (opsContext) {
            parts.push('Current bot ops snapshot (redacted JSON):\n' + opsContext);
        }
    }
    parts.push(userQuestion);
    return parts.join('\n\n');
}
function isStaleAgentError(err) {
    const msg = err instanceof sdk_1.CursorAgentError
        ? err.message
        : err instanceof Error
            ? err.message
            : String(err);
    const lower = msg.toLowerCase();
    return lower.includes('agent_not_found') || lower.includes('agent not found');
}
function isRetryableCursorError(err) {
    return err instanceof sdk_1.CursorAgentError && err.isRetryable;
}
function textFromSdkMessage(event) {
    if (event.type === 'assistant') {
        return event.message.content
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('')
            .trim();
    }
    if (event.type === 'tool_call' && event.status === 'error') {
        const detail = typeof event.result === 'string'
            ? event.result
            : event.result != null
                ? JSON.stringify(event.result)
                : '';
        return `Tool ${event.name} failed: ${detail}`.trim();
    }
    return '';
}
async function collectStreamText(run) {
    if (!run.supports('stream'))
        return '';
    const parts = [];
    try {
        for await (const event of run.stream()) {
            const text = textFromSdkMessage(event);
            if (text)
                parts.push(text);
        }
    }
    catch {
        /* optional */
    }
    return parts.join('\n').trim();
}
async function extractRunErrorText(run, result) {
    if (result.result?.trim()) {
        return result.result.trim();
    }
    if (run.result?.trim()) {
        return run.result.trim();
    }
    const streamText = await collectStreamText(run);
    if (streamText)
        return streamText;
    if (run.supports('conversation')) {
        try {
            const turns = await run.conversation();
            for (let i = turns.length - 1; i >= 0; i -= 1) {
                const turn = turns[i];
                const text = turn?.text?.trim();
                if (text)
                    return text;
            }
        }
        catch {
            /* optional */
        }
    }
    return (`Cursor Cloud lỗi tạm thời (status=${result.status}, run=${result.id}). ` +
        'Thử lại: /cursor new rồi hỏi lại, hoặc đợi 1–2 phút.');
}
async function acquireAgent(chatId, _userId, forceNew) {
    const baseOptions = (0, cursor_cloud_options_1.buildCloudAgentOptions)({
        model: telegram_ai_1.cursorChatConfig.model,
        autoCreatePR: false,
    });
    if (!forceNew) {
        const session = await loadCursorSession(chatId);
        if (session?.agent_id) {
            try {
                const agent = await sdk_1.Agent.resume(session.agent_id, baseOptions);
                return { agent, agentId: session.agent_id, isNew: false };
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`[CursorChat] resume ${session.agent_id} failed, creating new: ${msg}`);
                await clearCursorSession(chatId);
            }
        }
    }
    else {
        await clearCursorSession(chatId);
    }
    const agent = await sdk_1.Agent.create(baseOptions);
    return { agent, agentId: agent.agentId, isNew: true };
}
async function runCursorChat(chatId, userId, question, forceNew, isRetry = false) {
    if ((0, cursor_job_queue_1.isCursorJobCancelled)(chatId)) {
        (0, telegram_client_1.enqueueTelegramMessage)('❌ Đã hủy Cursor chat.', chatId);
        return;
    }
    let agent;
    try {
        const acquired = await acquireAgent(chatId, userId, forceNew || isRetry);
        agent = acquired.agent;
        const { agentId, isNew } = acquired;
        let opsContext;
        if (isNew) {
            const bundle = await (0, ai_context_builder_1.buildAiContext)('freeform');
            opsContext = (0, ai_context_builder_1.contextToJson)(bundle).slice(0, 4000);
        }
        const prompt = buildChatPrompt(question, isNew, opsContext);
        console.log(`[CursorChat] chat=${chatId} agent=${agentId} new=${isNew} q=${question.slice(0, 80)}`);
        const run = await agent.send(prompt, { mode: 'plan' });
        if ((0, cursor_job_queue_1.isCursorJobCancelled)(chatId)) {
            if (run.supports('cancel')) {
                await run.cancel().catch(() => undefined);
            }
            (0, telegram_client_1.enqueueTelegramMessage)('❌ Đã hủy Cursor chat.', chatId);
            return;
        }
        const result = await run.wait();
        if ((0, cursor_job_queue_1.isCursorJobCancelled)(chatId)) {
            (0, telegram_client_1.enqueueTelegramMessage)('❌ Đã hủy Cursor chat.', chatId);
            return;
        }
        if (result.status === 'error' || result.status === 'cancelled') {
            const errText = (await extractRunErrorText(run, result)).slice(0, 500);
            console.error(`[CursorChat] chat=${chatId} run failed status=${result.status} id=${result.id} durationMs=${result.durationMs ?? 'n/a'} err=${errText.slice(0, 200)}`);
            if (!isRetry && result.status === 'error') {
                await clearCursorSession(chatId);
                console.warn(`[CursorChat] chat=${chatId} retrying after cloud run error`);
                await runCursorChat(chatId, userId, question, true, true);
                return;
            }
            (0, telegram_client_1.enqueueTelegramMessage)(`❌ Cursor lỗi:\n${(0, message_formatters_1.escapeHtml)(errText)}`, chatId);
            return;
        }
        await saveCursorSession(chatId, userId, agentId);
        const answer = (result.result ?? '').trim() || '(Không có nội dung trả lời)';
        sendCursorReply(chatId, answer);
    }
    catch (err) {
        if (!isRetry &&
            (isStaleAgentError(err) || isRetryableCursorError(err))) {
            await clearCursorSession(chatId);
            console.warn(`[CursorChat] chat=${chatId} retrying after ${isStaleAgentError(err) ? 'stale agent' : 'retryable startup error'}`);
            await runCursorChat(chatId, userId, question, true, true);
            return;
        }
        throw err;
    }
    finally {
        await agent?.[Symbol.asyncDispose]().catch(() => undefined);
    }
}
function formatCursorChatError(err) {
    const base = err instanceof sdk_1.CursorAgentError
        ? `startup failed: ${err.message} (retryable=${err.isRetryable})`
        : err instanceof Error
            ? err.message
            : String(err);
    const lower = base.toLowerCase();
    if (lower.includes('failed to verify existence of branch') ||
        lower.includes('do not have access to repository')) {
        return (`${base}\n\n` +
            '💡 Cursor chưa thấy repo trên GitHub. Vào cursor.com/dashboard → Integrations → Connect GitHub, ' +
            'cài Cursor GitHub App và chọn repo Huy289cb/chuyen-gia-crypto, rồi thử /cursor lại.');
    }
    return base;
}
async function handleCursorStatusCommand(chatId) {
    const session = await loadCursorSession(chatId);
    if (!session) {
        (0, telegram_client_1.enqueueTelegramMessage)('Chưa có phiên /cursor. Gõ <code>/cursor câu hỏi</code> để bắt đầu.', chatId);
        return;
    }
    const ttlLeft = Math.max(0, telegram_ai_1.cursorChatConfig.sessionTtlMs - (Date.now() - session.updated_at.getTime()));
    const hoursLeft = Math.round(ttlLeft / 3_600_000);
    (0, telegram_client_1.enqueueTelegramMessage)([
        '<b>Phiên /cursor</b>',
        `Agent: <code>${(0, message_formatters_1.escapeHtml)(session.agent_id)}</code>`,
        `Cập nhật: ${session.updated_at.toISOString()}`,
        `Hết hạn sau ~${hoursLeft}h (hoặc /cursor new)`,
    ].join('\n'), chatId);
}
async function handleCursorCommand(chatId, userId, args) {
    if (!(0, telegram_ai_1.isCursorChatEnabled)()) {
        (0, telegram_client_1.enqueueTelegramMessage)('Cursor chat chưa bật (CURSOR_AGENT_ENABLED + CURSOR_API_KEY + CURSOR_AGENT_REPO_URL).', chatId);
        return;
    }
    if (!(0, telegram_ai_1.canUseCursorChat)(userId)) {
        (0, telegram_client_1.enqueueTelegramMessage)('⛔ /cursor chỉ dành cho admin (TELEGRAM_ALLOWED_USER_IDS). Đặt CURSOR_CHAT_ADMIN_ONLY=false để mở rộng.', chatId);
        return;
    }
    const trimmed = args.trim();
    const lower = trimmed.toLowerCase();
    if (!trimmed || lower === 'help') {
        (0, telegram_client_1.enqueueTelegramMessage)(CURSOR_HELP, chatId);
        return;
    }
    if (lower === 'cancel') {
        const cancelled = (0, cursor_job_queue_1.cancelCursorJobForChat)(chatId);
        (0, telegram_client_1.enqueueTelegramMessage)(cancelled ? '🛑 Đang hủy job Cursor (nếu còn chạy).' : 'Không có job Cursor đang chạy.', chatId);
        return;
    }
    if (lower === 'status') {
        await handleCursorStatusCommand(chatId);
        return;
    }
    const forceNew = lower === 'new' || lower.startsWith('new ');
    const question = forceNew ? trimmed.replace(/^new\s*/i, '').trim() : trimmed;
    if (forceNew && !question) {
        await clearCursorSession(chatId);
        (0, telegram_client_1.enqueueTelegramMessage)('✅ Phiên Cursor mới. Gõ câu hỏi tiếp theo.', chatId);
        return;
    }
    if (!question) {
        (0, telegram_client_1.enqueueTelegramMessage)(CURSOR_HELP, chatId);
        return;
    }
    const rateError = checkCursorRateLimit(userId);
    if (rateError) {
        (0, telegram_client_1.enqueueTelegramMessage)(rateError, chatId);
        return;
    }
    const enqueued = (0, cursor_job_queue_1.enqueueCursorJob)(chatId, async () => {
        try {
            await runCursorChat(chatId, userId, question.slice(0, 4000), forceNew);
        }
        catch (err) {
            if (isStaleAgentError(err)) {
                await clearCursorSession(chatId);
            }
            const msg = formatCursorChatError(err);
            console.error(`[CursorChat] chat=${chatId} failed: ${msg}`);
            (0, telegram_client_1.enqueueTelegramMessage)(`❌ Cursor chat: ${(0, message_formatters_1.escapeHtml)(msg.slice(0, 500))}`, chatId);
        }
    });
    if (!enqueued.ok) {
        (0, telegram_client_1.enqueueTelegramMessage)('⏳ Đang xử lý Cursor chat khác. Dùng /cursor cancel để hủy.', chatId);
        return;
    }
    (0, telegram_client_1.enqueueTelegramMessage)('🤖 Cursor đang suy nghĩ... (đọc repo, có thể 1–5 phút)\nDùng /cursor cancel nếu cần.', chatId);
}
//# sourceMappingURL=cursor-chat.service.js.map
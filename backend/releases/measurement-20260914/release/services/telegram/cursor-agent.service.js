"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleFixCommand = handleFixCommand;
exports.handleFixStatusCommand = handleFixStatusCommand;
const sdk_1 = require("@cursor/sdk");
const prisma_1 = require("../../lib/prisma");
const telegram_ai_1 = require("../../config/telegram-ai");
const ai_context_builder_1 = require("./ai-context.builder");
const cursor_cloud_options_1 = require("./cursor-cloud-options");
const telegram_client_1 = require("./telegram-client");
const message_formatters_1 = require("./message-formatters");
async function handleFixCommand(chatId, userId, description) {
    if (!(0, telegram_ai_1.isCursorAgentEnabled)()) {
        (0, telegram_client_1.enqueueTelegramMessage)('Cursor Agent chưa bật (CURSOR_AGENT_ENABLED + CURSOR_API_KEY + CURSOR_AGENT_REPO_URL).', chatId);
        return;
    }
    const trimmed = description.trim();
    if (!trimmed) {
        (0, telegram_client_1.enqueueTelegramMessage)('Dùng: /fix <mô tả bug cần sửa>', chatId);
        return;
    }
    const job = await prisma_1.prisma.aiFixJob.create({
        data: {
            chat_id: chatId,
            user_id: userId ?? null,
            description: trimmed.slice(0, 2000),
            status: 'pending',
        },
    });
    (0, telegram_client_1.enqueueTelegramMessage)(`🛠 Cursor Agent đang xử lý (job #${job.id})...\nCó thể mất 2–10+ phút.`, chatId);
    setImmediate(() => {
        void runFixJob(job.id, chatId, trimmed);
    });
}
async function runFixJob(jobId, chatId, description) {
    try {
        await prisma_1.prisma.aiFixJob.update({
            where: { id: jobId },
            data: { status: 'running' },
        });
        const bundle = await (0, ai_context_builder_1.buildAiContext)('errors');
        const contextJson = (0, ai_context_builder_1.contextToJson)(bundle);
        const prompt = [
            'Fix the following issue in the repository. Create a focused PR with tests if applicable.',
            '',
            `Issue description (from Telegram ops): ${description}`,
            '',
            'Recent errors context (JSON, redacted):',
            contextJson.slice(0, 8000),
            '',
            'Constraints:',
            '- Do not change BINANCE_* secrets or risk policy without explicit approval',
            '- Do not auto-deploy',
            '- Match existing TypeScript conventions (strict mode)',
        ].join('\n');
        console.log(`[CursorAgent] job=${jobId} starting cloud agent repo=${telegram_ai_1.cursorAgentConfig.repoUrl}`);
        const result = await sdk_1.Agent.prompt(prompt, {
            ...(0, cursor_cloud_options_1.buildCloudAgentOptions)({
                model: telegram_ai_1.cursorAgentConfig.model,
                autoCreatePR: true,
            }),
        });
        const prUrl = result.git?.branches?.find((b) => b.prUrl)?.prUrl ??
            extractPrUrlFromText(result.result ?? '');
        await prisma_1.prisma.aiFixJob.update({
            where: { id: jobId },
            data: {
                status: result.status === 'finished' ? 'finished' : result.status === 'error' ? 'error' : 'finished',
                run_id: result.id ?? null,
                pr_url: prUrl ?? null,
                error_message: result.status === 'error' ? (result.result ?? 'Agent run failed').slice(0, 1000) : null,
            },
        });
        if (result.status === 'error') {
            (0, telegram_client_1.enqueueTelegramMessage)(`❌ Cursor Agent job #${jobId} lỗi.\n${(0, message_formatters_1.escapeHtml)((result.result ?? 'unknown').slice(0, 300))}`, chatId);
            return;
        }
        const lines = [
            `✅ Cursor Agent job #${jobId} hoàn tất.`,
            `Status: ${(0, message_formatters_1.escapeHtml)(result.status)}`,
        ];
        if (prUrl)
            lines.push(`PR: ${(0, message_formatters_1.escapeHtml)(prUrl)}`);
        else if (result.result)
            lines.push((0, message_formatters_1.escapeHtml)(result.result.slice(0, 500)));
        lines.push('', 'Review PR trên GitHub → merge → ./scripts/deploy.sh');
        (0, telegram_client_1.enqueueTelegramMessage)(lines.join('\n'), chatId);
    }
    catch (err) {
        const msg = err instanceof sdk_1.CursorAgentError
            ? `startup failed: ${err.message} (retryable=${err.isRetryable})`
            : err instanceof Error
                ? err.message
                : String(err);
        console.error(`[CursorAgent] job=${jobId} failed: ${msg}`);
        await prisma_1.prisma.aiFixJob
            .update({
            where: { id: jobId },
            data: { status: 'error', error_message: msg.slice(0, 1000) },
        })
            .catch(() => undefined);
        (0, telegram_client_1.enqueueTelegramMessage)(`❌ Cursor Agent job #${jobId}: ${(0, message_formatters_1.escapeHtml)(msg.slice(0, 300))}`, chatId);
    }
}
function extractPrUrlFromText(text) {
    const match = text.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/i);
    return match?.[0];
}
async function handleFixStatusCommand(chatId) {
    const job = await prisma_1.prisma.aiFixJob.findFirst({
        where: { chat_id: chatId },
        orderBy: { created_at: 'desc' },
    });
    if (!job) {
        (0, telegram_client_1.enqueueTelegramMessage)('Chưa có job /fix nào.', chatId);
        return;
    }
    const lines = [
        `<b>Fix job #${job.id}</b>`,
        `Status: ${(0, message_formatters_1.escapeHtml)(job.status)}`,
        `Mô tả: ${(0, message_formatters_1.escapeHtml)(job.description.slice(0, 120))}`,
    ];
    if (job.agent_id)
        lines.push(`Agent: ${(0, message_formatters_1.escapeHtml)(job.agent_id)}`);
    if (job.pr_url)
        lines.push(`PR: ${(0, message_formatters_1.escapeHtml)(job.pr_url)}`);
    if (job.error_message)
        lines.push(`Lỗi: ${(0, message_formatters_1.escapeHtml)(job.error_message.slice(0, 200))}`);
    lines.push(`Tạo: ${job.created_at.toISOString()}`);
    (0, telegram_client_1.enqueueTelegramMessage)(lines.join('\n'), chatId);
}
//# sourceMappingURL=cursor-agent.service.js.map
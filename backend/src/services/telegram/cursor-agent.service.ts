import { Agent, CursorAgentError } from '@cursor/sdk';
import { prisma } from '../../lib/prisma';
import { cursorAgentConfig, isCursorAgentEnabled } from '../../config/telegram-ai';
import { buildAiContext, contextToJson } from './ai-context.builder';
import { enqueueTelegramMessage } from './telegram-client';
import { escapeHtml } from './message-formatters';

export async function handleFixCommand(
  chatId: string,
  userId: string | undefined,
  description: string
): Promise<void> {
  if (!isCursorAgentEnabled()) {
    enqueueTelegramMessage(
      'Cursor Agent chưa bật (CURSOR_AGENT_ENABLED + CURSOR_API_KEY + CURSOR_AGENT_REPO_URL).',
      chatId
    );
    return;
  }

  const trimmed = description.trim();
  if (!trimmed) {
    enqueueTelegramMessage('Dùng: /fix <mô tả bug cần sửa>', chatId);
    return;
  }

  const job = await prisma.aiFixJob.create({
    data: {
      chat_id: chatId,
      user_id: userId ?? null,
      description: trimmed.slice(0, 2000),
      status: 'pending',
    },
  });

  enqueueTelegramMessage(
    `🛠 Cursor Agent đang xử lý (job #${job.id})...\nCó thể mất 2–10+ phút.`,
    chatId
  );

  setImmediate(() => {
    void runFixJob(job.id, chatId, trimmed);
  });
}

async function runFixJob(jobId: number, chatId: string, description: string): Promise<void> {
  try {
    await prisma.aiFixJob.update({
      where: { id: jobId },
      data: { status: 'running' },
    });

    const bundle = await buildAiContext('errors');
    const contextJson = contextToJson(bundle);

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

    console.log(`[CursorAgent] job=${jobId} starting cloud agent repo=${cursorAgentConfig.repoUrl}`);

    const result = await Agent.prompt(prompt, {
      apiKey: cursorAgentConfig.apiKey,
      model: { id: cursorAgentConfig.model },
      cloud: {
        repos: [
          {
            url: cursorAgentConfig.repoUrl,
            startingRef: cursorAgentConfig.baseBranch,
          },
        ],
        autoCreatePR: true,
        skipReviewerRequest: true,
      },
    });

    const prUrl =
      result.git?.branches?.find((b) => b.prUrl)?.prUrl ??
      extractPrUrlFromText(result.result ?? '');

    await prisma.aiFixJob.update({
      where: { id: jobId },
      data: {
        status: result.status === 'finished' ? 'finished' : result.status === 'error' ? 'error' : 'finished',
        run_id: result.id ?? null,
        pr_url: prUrl ?? null,
        error_message:
          result.status === 'error' ? (result.result ?? 'Agent run failed').slice(0, 1000) : null,
      },
    });

    if (result.status === 'error') {
      enqueueTelegramMessage(
        `❌ Cursor Agent job #${jobId} lỗi.\n${escapeHtml((result.result ?? 'unknown').slice(0, 300))}`,
        chatId
      );
      return;
    }

    const lines = [
      `✅ Cursor Agent job #${jobId} hoàn tất.`,
      `Status: ${escapeHtml(result.status)}`,
    ];
    if (prUrl) lines.push(`PR: ${escapeHtml(prUrl)}`);
    else if (result.result) lines.push(escapeHtml(result.result.slice(0, 500)));
    lines.push('', 'Review PR trên GitHub → merge → ./scripts/deploy.sh');

    enqueueTelegramMessage(lines.join('\n'), chatId);
  } catch (err: unknown) {
    const msg =
      err instanceof CursorAgentError
        ? `startup failed: ${err.message} (retryable=${err.isRetryable})`
        : err instanceof Error
          ? err.message
          : String(err);

    console.error(`[CursorAgent] job=${jobId} failed: ${msg}`);

    await prisma.aiFixJob
      .update({
        where: { id: jobId },
        data: { status: 'error', error_message: msg.slice(0, 1000) },
      })
      .catch(() => undefined);

    enqueueTelegramMessage(`❌ Cursor Agent job #${jobId}: ${escapeHtml(msg.slice(0, 300))}`, chatId);
  }
}

function extractPrUrlFromText(text: string): string | undefined {
  const match = text.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/i);
  return match?.[0];
}

export async function handleFixStatusCommand(chatId: string): Promise<void> {
  const job = await prisma.aiFixJob.findFirst({
    where: { chat_id: chatId },
    orderBy: { created_at: 'desc' },
  });

  if (!job) {
    enqueueTelegramMessage('Chưa có job /fix nào.', chatId);
    return;
  }

  const lines = [
    `<b>Fix job #${job.id}</b>`,
    `Status: ${escapeHtml(job.status)}`,
    `Mô tả: ${escapeHtml(job.description.slice(0, 120))}`,
  ];
  if (job.agent_id) lines.push(`Agent: ${escapeHtml(job.agent_id)}`);
  if (job.pr_url) lines.push(`PR: ${escapeHtml(job.pr_url)}`);
  if (job.error_message) lines.push(`Lỗi: ${escapeHtml(job.error_message.slice(0, 200))}`);
  lines.push(`Tạo: ${job.created_at.toISOString()}`);

  enqueueTelegramMessage(lines.join('\n'), chatId);
}

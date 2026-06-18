import { Agent, CursorAgentError } from '@cursor/sdk';
import type { Run, RunResult } from '@cursor/sdk';
import { prisma } from '../../lib/prisma';
import {
  canUseCursorChat,
  cursorChatConfig,
  isCursorChatEnabled,
} from '../../config/telegram-ai';
import { buildAiContext, contextToJson, splitMessageForTelegram } from './ai-context.builder';
import { buildCloudAgentOptions } from './cursor-cloud-options';
import {
  cancelCursorJobForChat,
  enqueueCursorJob,
  isCursorJobCancelled,
} from './cursor-job-queue';
import { enqueueTelegramMessage } from './telegram-client';
import { escapeHtml } from './message-formatters';

const userRateTimestamps = new Map<string, number[]>();

const CURSOR_HELP = `🤖 <b>/cursor</b> — chat với Cursor (đọc repo, hỏi gì cũng được)

• <code>/cursor câu hỏi</code> — hỏi tiếp (nhớ hội thoại ~24h)
• <code>/cursor new</code> — phiên mới
• <code>/cursor status</code> — trạng thái phiên
• <code>/cursor cancel</code> — hủy job đang chạy

Khác <code>/ai</code> (Groq, nhanh): Cursor đọc codebase thật, chậm hơn (1–5 phút).
Khác <code>/fix</code>: không tự tạo PR — chỉ chat. Muốn sửa code → <code>/fix mô tả</code>.`;

function checkCursorRateLimit(userId: string | undefined): string | null {
  if (!userId) return null;
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const timestamps = (userRateTimestamps.get(userId) ?? []).filter((t) => t > hourAgo);
  if (timestamps.length >= cursorChatConfig.rateLimitPerUserHour) {
    return `⏳ Cursor chat: tối đa ${cursorChatConfig.rateLimitPerUserHour} lần/giờ. Thử lại sau.`;
  }
  timestamps.push(now);
  userRateTimestamps.set(userId, timestamps);
  return null;
}

function sendCursorReply(chatId: string, text: string): void {
  const chunks = splitMessageForTelegram(text, 3800);
  for (const chunk of chunks) {
    enqueueTelegramMessage(chunk, chatId, { plainText: true });
  }
}

async function loadCursorSession(chatId: string): Promise<{
  agent_id: string;
  updated_at: Date;
} | null> {
  const row = await prisma.aiCursorSession.findUnique({ where: { chat_id: chatId } });
  if (!row) return null;
  if (Date.now() - row.updated_at.getTime() > cursorChatConfig.sessionTtlMs) {
    await prisma.aiCursorSession.delete({ where: { chat_id: chatId } }).catch(() => undefined);
    return null;
  }
  return { agent_id: row.agent_id, updated_at: row.updated_at };
}

async function saveCursorSession(
  chatId: string,
  userId: string | undefined,
  agentId: string
): Promise<void> {
  await prisma.aiCursorSession.upsert({
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

async function clearCursorSession(chatId: string): Promise<void> {
  await prisma.aiCursorSession.delete({ where: { chat_id: chatId } }).catch(() => undefined);
}

function buildChatPrompt(userQuestion: string, isNewSession: boolean, opsContext?: string): string {
  const parts: string[] = [];
  if (isNewSession) {
    parts.push(
      'You are Cursor assistant for the Kim Nghia crypto trading bot (BTC Binance testnet, Node backend).',
      'Answer in Vietnamese unless the user uses another language.',
      'Default: read-only Q&A — explain code and ops clearly for a non-expert operator.',
      'Do NOT commit, push, or open PR unless the user explicitly asks to implement or fix something in the repo.',
      'Keep answers concise (Telegram ~4000 char limit). Use short paragraphs or bullets.'
    );
    if (opsContext) {
      parts.push('Current bot ops snapshot (redacted JSON):\n' + opsContext);
    }
  }
  parts.push(userQuestion);
  return parts.join('\n\n');
}

function isStaleAgentError(err: unknown): boolean {
  const msg =
    err instanceof CursorAgentError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  const lower = msg.toLowerCase();
  return lower.includes('agent_not_found') || lower.includes('agent not found');
}

async function extractRunErrorText(run: Run, result: RunResult): Promise<string> {
  if (result.result?.trim()) {
    return result.result.trim();
  }
  if (run.result?.trim()) {
    return run.result.trim();
  }
  if (run.supports('conversation')) {
    try {
      const turns = await run.conversation();
      for (let i = turns.length - 1; i >= 0; i -= 1) {
        const turn = turns[i] as { text?: string };
        const text = turn?.text?.trim();
        if (text) return text;
      }
    } catch {
      /* optional */
    }
  }
  return `Cursor run failed (status=${result.status})`;
}

async function acquireAgent(
  chatId: string,
  _userId: string | undefined,
  forceNew: boolean
): Promise<{ agent: Awaited<ReturnType<typeof Agent.create>>; agentId: string; isNew: boolean }> {
  const baseOptions = buildCloudAgentOptions({
    model: cursorChatConfig.model,
    autoCreatePR: false,
  });

  if (!forceNew) {
    const session = await loadCursorSession(chatId);
    if (session?.agent_id) {
      try {
        const agent = await Agent.resume(session.agent_id, baseOptions);
        return { agent, agentId: session.agent_id, isNew: false };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[CursorChat] resume ${session.agent_id} failed, creating new: ${msg}`);
        await clearCursorSession(chatId);
      }
    }
  } else {
    await clearCursorSession(chatId);
  }

  const agent = await Agent.create(baseOptions);
  return { agent, agentId: agent.agentId, isNew: true };
}

async function runCursorChat(
  chatId: string,
  userId: string | undefined,
  question: string,
  forceNew: boolean,
  isRetry = false
): Promise<void> {
  if (isCursorJobCancelled(chatId)) {
    enqueueTelegramMessage('❌ Đã hủy Cursor chat.', chatId);
    return;
  }

  let agent: Awaited<ReturnType<typeof Agent.create>> | undefined;
  try {
    const acquired = await acquireAgent(chatId, userId, forceNew || isRetry);
    agent = acquired.agent;
    const { agentId, isNew } = acquired;

    let opsContext: string | undefined;
    if (isNew) {
      const bundle = await buildAiContext('freeform');
      opsContext = contextToJson(bundle).slice(0, 4000);
    }

    const prompt = buildChatPrompt(question, isNew, opsContext);
    console.log(`[CursorChat] chat=${chatId} agent=${agentId} new=${isNew} q=${question.slice(0, 80)}`);

    const run = await agent.send(prompt, { mode: 'plan' });

    if (isCursorJobCancelled(chatId)) {
      if (run.supports('cancel')) {
        await run.cancel().catch(() => undefined);
      }
      enqueueTelegramMessage('❌ Đã hủy Cursor chat.', chatId);
      return;
    }

    const result = await run.wait();

    if (isCursorJobCancelled(chatId)) {
      enqueueTelegramMessage('❌ Đã hủy Cursor chat.', chatId);
      return;
    }

    if (result.status === 'error' || result.status === 'cancelled') {
      const errText = (await extractRunErrorText(run, result)).slice(0, 500);
      console.error(
        `[CursorChat] chat=${chatId} run failed status=${result.status} id=${result.id} durationMs=${result.durationMs ?? 'n/a'}`
      );
      enqueueTelegramMessage(`❌ Cursor lỗi:\n${escapeHtml(errText)}`, chatId);
      return;
    }

    await saveCursorSession(chatId, userId, agentId);

    const answer = (result.result ?? '').trim() || '(Không có nội dung trả lời)';
    sendCursorReply(chatId, answer);
  } catch (err: unknown) {
    if (!isRetry && isStaleAgentError(err)) {
      await clearCursorSession(chatId);
      console.warn(`[CursorChat] chat=${chatId} stale agent, retrying with new session`);
      await runCursorChat(chatId, userId, question, true, true);
      return;
    }
    throw err;
  } finally {
    await agent?.[Symbol.asyncDispose]().catch(() => undefined);
  }
}

function formatCursorChatError(err: unknown): string {
  const base =
    err instanceof CursorAgentError
      ? `startup failed: ${err.message} (retryable=${err.isRetryable})`
      : err instanceof Error
        ? err.message
        : String(err);

  const lower = base.toLowerCase();
  if (
    lower.includes('failed to verify existence of branch') ||
    lower.includes('do not have access to repository')
  ) {
    return (
      `${base}\n\n` +
      '💡 Cursor chưa thấy repo trên GitHub. Vào cursor.com/dashboard → Integrations → Connect GitHub, ' +
      'cài Cursor GitHub App và chọn repo Huy289cb/chuyen-gia-crypto, rồi thử /cursor lại.'
    );
  }

  return base;
}

export async function handleCursorStatusCommand(chatId: string): Promise<void> {
  const session = await loadCursorSession(chatId);
  if (!session) {
    enqueueTelegramMessage('Chưa có phiên /cursor. Gõ <code>/cursor câu hỏi</code> để bắt đầu.', chatId);
    return;
  }

  const ttlLeft = Math.max(
    0,
    cursorChatConfig.sessionTtlMs - (Date.now() - session.updated_at.getTime())
  );
  const hoursLeft = Math.round(ttlLeft / 3_600_000);

  enqueueTelegramMessage(
    [
      '<b>Phiên /cursor</b>',
      `Agent: <code>${escapeHtml(session.agent_id)}</code>`,
      `Cập nhật: ${session.updated_at.toISOString()}`,
      `Hết hạn sau ~${hoursLeft}h (hoặc /cursor new)`,
    ].join('\n'),
    chatId
  );
}

export async function handleCursorCommand(
  chatId: string,
  userId: string | undefined,
  args: string
): Promise<void> {
  if (!isCursorChatEnabled()) {
    enqueueTelegramMessage(
      'Cursor chat chưa bật (CURSOR_AGENT_ENABLED + CURSOR_API_KEY + CURSOR_AGENT_REPO_URL).',
      chatId
    );
    return;
  }

  if (!canUseCursorChat(userId)) {
    enqueueTelegramMessage(
      '⛔ /cursor chỉ dành cho admin (TELEGRAM_ALLOWED_USER_IDS). Đặt CURSOR_CHAT_ADMIN_ONLY=false để mở rộng.',
      chatId
    );
    return;
  }

  const trimmed = args.trim();
  const lower = trimmed.toLowerCase();

  if (!trimmed || lower === 'help') {
    enqueueTelegramMessage(CURSOR_HELP, chatId);
    return;
  }

  if (lower === 'cancel') {
    const cancelled = cancelCursorJobForChat(chatId);
    enqueueTelegramMessage(
      cancelled ? '🛑 Đang hủy job Cursor (nếu còn chạy).' : 'Không có job Cursor đang chạy.',
      chatId
    );
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
    enqueueTelegramMessage('✅ Phiên Cursor mới. Gõ câu hỏi tiếp theo.', chatId);
    return;
  }

  if (!question) {
    enqueueTelegramMessage(CURSOR_HELP, chatId);
    return;
  }

  const rateError = checkCursorRateLimit(userId);
  if (rateError) {
    enqueueTelegramMessage(rateError, chatId);
    return;
  }

  const enqueued = enqueueCursorJob(chatId, async () => {
    try {
      await runCursorChat(chatId, userId, question.slice(0, 4000), forceNew);
    } catch (err: unknown) {
      if (isStaleAgentError(err)) {
        await clearCursorSession(chatId);
      }
      const msg = formatCursorChatError(err);
      console.error(`[CursorChat] chat=${chatId} failed: ${msg}`);
      enqueueTelegramMessage(`❌ Cursor chat: ${escapeHtml(msg.slice(0, 500))}`, chatId);
    }
  });

  if (!enqueued.ok) {
    enqueueTelegramMessage('⏳ Đang xử lý Cursor chat khác. Dùng /cursor cancel để hủy.', chatId);
    return;
  }

  enqueueTelegramMessage(
    '🤖 Cursor đang suy nghĩ... (đọc repo, có thể 1–5 phút)\nDùng /cursor cancel nếu cần.',
    chatId
  );
}

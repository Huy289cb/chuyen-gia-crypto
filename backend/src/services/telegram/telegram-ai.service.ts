import * as fs from 'fs';
import * as path from 'path';
import { getIctDateString } from '../../utils/ict-time';
import { prisma } from '../../lib/prisma';
import {
  isTelegramAiEnabled,
  isTelegramAdminUser,
  telegramAiConfig,
} from '../../config/telegram-ai';
import { createGroqClient } from '../groq-client';
import {
  buildAiContext,
  contextToJson,
  parseAiCommandArgs,
  redactSensitiveText,
  splitMessageForTelegram,
  type AiContextScope,
} from './ai-context.builder';
import { getSystemPrompt, getUserPrompt } from './ai-prompts';
import {
  cancelAiJobForChat,
  enqueueAiJob,
  isAiJobCancelled,
} from './ai-job-queue';
import { enqueueTelegramMessage } from './telegram-client';
import { escapeHtml } from './message-formatters';

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SESSION_TURNS = 3;

interface SessionTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface InMemorySession {
  turns: SessionTurn[];
  updatedAt: number;
}

const inMemorySessions = new Map<string, InMemorySession>();
const userRateTimestamps = new Map<string, number[]>();
const chatDayCounts = new Map<string, { ictDate: string; count: number }>();

function getSession(chatId: string): InMemorySession | undefined {
  const mem = inMemorySessions.get(chatId);
  if (!mem) return undefined;
  if (Date.now() - mem.updatedAt > SESSION_TTL_MS) {
    inMemorySessions.delete(chatId);
    return undefined;
  }
  return mem;
}

async function loadSession(chatId: string): Promise<InMemorySession | undefined> {
  const mem = getSession(chatId);
  if (mem) return mem;

  try {
    const row = await prisma.aiSession.findUnique({ where: { chat_id: chatId } });
    if (!row) return undefined;
    if (Date.now() - row.updated_at.getTime() > SESSION_TTL_MS) {
      await prisma.aiSession.delete({ where: { chat_id: chatId } }).catch(() => undefined);
      return undefined;
    }
    const turns = JSON.parse(row.turns_json) as SessionTurn[];
    const session = { turns, updatedAt: row.updated_at.getTime() };
    inMemorySessions.set(chatId, session);
    return session;
  } catch {
    return undefined;
  }
}

async function saveSession(chatId: string, userId: string | undefined, session: InMemorySession): Promise<void> {
  inMemorySessions.set(chatId, session);
  try {
    await prisma.aiSession.upsert({
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[TelegramAI] session persist failed chat=${chatId}: ${msg}`);
  }
}

function pushSessionTurn(chatId: string, userId: string | undefined, userQ: string, assistantA: string): void {
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

function checkRateLimit(userId: string | undefined, chatId: string): string | null {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;

  if (userId) {
    const key = userId;
    const timestamps = (userRateTimestamps.get(key) ?? []).filter((t) => t > hourAgo);
    if (timestamps.length >= telegramAiConfig.rateLimitPerUserHour) {
      return `⏳ Rate limit: tối đa ${telegramAiConfig.rateLimitPerUserHour} lần/giờ/user. Thử lại sau.`;
    }
    timestamps.push(now);
    userRateTimestamps.set(key, timestamps);
  }

  const ictDate = getIctDateString();
  const chatEntry = chatDayCounts.get(chatId);
  if (!chatEntry || chatEntry.ictDate !== ictDate) {
    chatDayCounts.set(chatId, { ictDate, count: 1 });
  } else {
    if (chatEntry.count >= telegramAiConfig.rateLimitPerChatDay) {
      return `⏳ Rate limit: tối đa ${telegramAiConfig.rateLimitPerChatDay} lần/ngày/chat (ICT).`;
    }
    chatEntry.count += 1;
  }

  return null;
}

function sendAiReply(chatId: string, text: string): void {
  const chunks = splitMessageForTelegram(text);
  for (const chunk of chunks) {
    enqueueTelegramMessage(escapeHtml(chunk), chatId);
  }
}

async function runAiAnalysis(
  chatId: string,
  userId: string | undefined,
  scope: AiContextScope,
  question?: string
): Promise<void> {
  if (isAiJobCancelled(chatId)) {
    enqueueTelegramMessage('❌ Đã hủy phân tích.', chatId);
    return;
  }

  const groq = createGroqClient();
  if (!groq) {
    enqueueTelegramMessage('❌ Groq chưa cấu hình (GROQ_API_KEY).', chatId);
    return;
  }

  const bundle = await buildAiContext(scope);
  if (isAiJobCancelled(chatId)) {
    enqueueTelegramMessage('❌ Đã hủy phân tích.', chatId);
    return;
  }

  const session = scope === 'freeform' ? await loadSession(chatId) : undefined;
  const contextJson = contextToJson(bundle);
  const systemPrompt = getSystemPrompt(scope);
  const userPrompt = getUserPrompt(scope, contextJson, question, session?.turns);

  const answer = await groq.completeText({
    systemPrompt,
    userPrompt,
    temperature: 0.3,
    maxTokens: telegramAiConfig.maxTokens,
    preferredModels: [telegramAiConfig.model],
  });

  if (isAiJobCancelled(chatId)) {
    enqueueTelegramMessage('❌ Đã hủy phân tích.', chatId);
    return;
  }

  sendAiReply(chatId, answer);

  if (scope === 'freeform' && question) {
    pushSessionTurn(chatId, userId, question, answer);
  }
}

export async function handleAiCommand(
  chatId: string,
  userId: string | undefined,
  args: string
): Promise<void> {
  if (!isTelegramAiEnabled()) {
    enqueueTelegramMessage('AI Q&A chưa bật (TELEGRAM_AI_ENABLED=false).', chatId);
    return;
  }

  const parsed = parseAiCommandArgs(args);

  if (parsed.action === 'cancel') {
    const cancelled = cancelAiJobForChat(chatId);
    enqueueTelegramMessage(
      cancelled ? '🛑 Đang hủy job AI (nếu còn chạy).' : 'Không có job AI đang chạy.',
      chatId
    );
    return;
  }

  if (parsed.scope === 'freeform' && !parsed.question) {
    enqueueTelegramMessage('Dùng: /ai vi <câu hỏi>', chatId);
    return;
  }

  const rateError = checkRateLimit(userId, chatId);
  if (rateError) {
    enqueueTelegramMessage(rateError, chatId);
    return;
  }

  const enqueued = enqueueAiJob(chatId, userId, parsed.scope, async () => {
    try {
      await runAiAnalysis(chatId, userId, parsed.scope, parsed.question);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[TelegramAI] analysis failed chat=${chatId}: ${msg}`);
      enqueueTelegramMessage(`❌ Lỗi phân tích AI: ${escapeHtml(msg.slice(0, 200))}`, chatId);
    }
  });

  if (!enqueued.ok) {
    enqueueTelegramMessage('⏳ Đang xử lý job AI khác. Dùng /ai cancel để hủy.', chatId);
    return;
  }

  enqueueTelegramMessage('🔍 Đang phân tích... (tối đa 60s)', chatId);
}

export async function runTelegramAiQuery(
  scope: AiContextScope,
  question?: string
): Promise<{ answer: string; scope: AiContextScope; generatedAt: string }> {
  const groq = createGroqClient();
  if (!groq) {
    throw new Error('Groq not configured');
  }

  const bundle = await buildAiContext(scope);
  const contextJson = contextToJson(bundle);
  const systemPrompt = getSystemPrompt(scope);
  const userPrompt = getUserPrompt(scope, contextJson, question);

  const answer = await groq.completeText({
    systemPrompt,
    userPrompt,
    temperature: 0.3,
    maxTokens: telegramAiConfig.maxTokens,
    preferredModels: [telegramAiConfig.model],
  });

  return { answer, scope, generatedAt: bundle.meta.generatedAt };
}

const LOG_PATH = path.join(__dirname, '../../../logs/worker-error.log');

export async function handleLogsCommand(
  chatId: string,
  userId: string | undefined
): Promise<void> {
  if (!isTelegramAdminUser(userId)) {
    enqueueTelegramMessage('⛔ Lệnh /logs chỉ dành cho admin (TELEGRAM_ALLOWED_USER_IDS).', chatId);
    return;
  }

  try {
    if (!fs.existsSync(LOG_PATH)) {
      enqueueTelegramMessage('Không tìm thấy worker-error.log.', chatId);
      return;
    }

    const content = fs.readFileSync(LOG_PATH, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const tail = lines.slice(-30).map(redactSensitiveText).join('\n');
    const msg = tail.length > 0 ? tail : '(log trống)';
    const chunks = splitMessageForTelegram(msg, 3800);
    for (const chunk of chunks) {
      enqueueTelegramMessage(`<pre>${escapeHtml(chunk)}</pre>`, chatId);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    enqueueTelegramMessage(`❌ Không đọc được log: ${escapeHtml(msg)}`, chatId);
  }
}

export function handleDeployHelpCommand(chatId: string): void {
  const text = [
    '<b>Deploy thủ công</b>',
    '1. Review + merge PR trên GitHub',
    '2. SSH VPS: cd ~/chuyen-gia-crypto && ./scripts/deploy.sh',
    '3. Kiểm tra: pm2 status && curl -s http://127.0.0.1:3000/health',
    '',
    'Cursor /fix chỉ tạo draft PR — không auto-deploy.',
  ].join('\n');
  enqueueTelegramMessage(text, chatId);
}

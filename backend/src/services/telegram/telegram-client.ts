import axios, { isAxiosError } from 'axios';
import { isTelegramEnabled, telegramConfig } from '../../config/telegram';

const API_BASE = 'https://api.telegram.org';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    caption?: string;
    photo?: Array<{ file_id: string }>;
    chat: { id: number; type: string };
    from?: { id: number; username?: string; first_name?: string };
  };
}

let sendQueue: Promise<void> = Promise.resolve();
let lastSendAt = 0;
const MIN_SEND_INTERVAL_MS = 1000;
const QUEUE_MAX_ATTEMPTS = 5;

function botUrl(method: string): string {
  return `${API_BASE}/bot${telegramConfig.botToken}/${method}`;
}

function formatTelegramApiError(err: unknown): string {
  if (isAxiosError(err)) {
    const data = err.response?.data as { description?: string; error_code?: number } | undefined;
    if (data?.description) {
      return data.error_code != null
        ? `${data.description} (code ${data.error_code})`
        : data.description;
    }
    if (err.code) return `${err.code}${err.message ? `: ${err.message}` : ''}`;
    if (err.message) return err.message;
    return `HTTP ${err.response?.status ?? '?'}`;
  }
  if (err instanceof Error) return err.message || err.name;
  return String(err) || 'unknown error';
}

function isHtmlParseError(description: string): boolean {
  const d = description.toLowerCase();
  return d.includes("can't parse") || d.includes('parse entities') || d.includes('unsupported');
}

async function throttleSend(): Promise<void> {
  const wait = Math.max(0, MIN_SEND_INTERVAL_MS - (Date.now() - lastSendAt));
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastSendAt = Date.now();
}

async function postSendMessage(
  chatId: string,
  text: string,
  parseMode?: 'HTML'
): Promise<void> {
  const payload = {
    chat_id: chatId,
    text,
    ...(parseMode ? { parse_mode: parseMode } : {}),
    disable_web_page_preview: true,
  };

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await axios.post(botUrl('sendMessage'), payload, { timeout: 25_000 });
      return;
    } catch (err: unknown) {
      lastErr = err;
      const msg = formatTelegramApiError(err);
      const retryable =
        msg.includes('ETIMEDOUT') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ENOTFOUND') ||
        msg.includes('429');
      if (!retryable || attempt === 2) throw err;
      console.warn(`[Telegram] send retry ${attempt}/2 chat=${chatId}: ${msg}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

async function sendChunk(chatId: string, chunk: string): Promise<void> {
  try {
    await postSendMessage(chatId, chunk, 'HTML');
  } catch (err: unknown) {
    const desc = formatTelegramApiError(err);
    if (isHtmlParseError(desc)) {
      console.warn(`[Telegram] HTML parse failed chat=${chatId}, retry plain text`);
      await postSendMessage(chatId, chunk);
      return;
    }
    throw err;
  }
}

export async function sendTelegramMessage(
  text: string,
  chatId?: string,
  options?: { plainText?: boolean }
): Promise<boolean> {
  if (!isTelegramEnabled()) return false;
  if (!text?.trim()) {
    console.warn('[Telegram] skip empty message');
    return false;
  }

  const parseMode = options?.plainText ? undefined : ('HTML' as const);
  const targets = chatId ? [chatId] : telegramConfig.chatIds;
  let anyOk = false;

  for (const id of targets) {
    try {
      await throttleSend();
      const chunks = splitMessage(text, 4000);
      for (const chunk of chunks) {
        if (parseMode) {
          await sendChunk(id, chunk);
        } else {
          await postSendMessage(id, chunk);
        }
        if (chunks.length > 1) await throttleSend();
      }
      anyOk = true;
    } catch (err: unknown) {
      const msg = formatTelegramApiError(err);
      console.error(`[Telegram] sendMessage failed chat=${id}: ${msg}`);
    }
  }
  return anyOk;
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('\n', maxLen);
    if (cut < maxLen * 0.5) cut = maxLen;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

export function enqueueTelegramMessage(
  text: string,
  chatId?: string,
  options?: { plainText?: boolean }
): void {
  sendQueue = sendQueue
    .then(async () => {
      for (let attempt = 1; attempt <= QUEUE_MAX_ATTEMPTS; attempt++) {
        const sent = await sendTelegramMessage(text, chatId, options);
        if (sent) return;

        const delayMs = Math.min(60_000, 2_000 * 2 ** (attempt - 1));
        if (attempt === QUEUE_MAX_ATTEMPTS) {
          console.error(`[Telegram] queued send abandoned after ${QUEUE_MAX_ATTEMPTS} attempts`);
          return;
        }
        console.warn(
          `[Telegram] queued send failed attempt ${attempt}/${QUEUE_MAX_ATTEMPTS}; retry in ${delayMs}ms`
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    })
    .catch((e) => console.error('[Telegram] queue error:', formatTelegramApiError(e)));
}

export async function getTelegramUpdates(
  offset?: number,
  timeoutSeconds = 25
): Promise<TelegramUpdate[]> {
  if (!telegramConfig.botToken) return [];
  const params: Record<string, unknown> = {
    timeout: timeoutSeconds,
    allowed_updates: ['message'],
  };
  if (offset != null && offset > 0) params.offset = offset;
  console.log(
    `[Telegram] getUpdates START pid=${process.pid} offset=${offset ?? 'none'} timeout=${timeoutSeconds}s`
  );
  try {
    const res = await axios.get(botUrl('getUpdates'), {
      params,
      timeout: (timeoutSeconds + 10) * 1000,
    });
    const updates = (res.data?.result as TelegramUpdate[]) || [];
    console.log(`[Telegram] getUpdates END pid=${process.pid} count=${updates.length}`);
    return updates;
  } catch (err: unknown) {
    console.error(`[Telegram] getUpdates error: ${formatTelegramApiError(err)}`);
    return [];
  }
}

/** Clear webhook so getUpdates/polling can receive messages. */
export async function deleteTelegramWebhook(): Promise<void> {
  if (!telegramConfig.botToken) return;
  try {
    await axios.post(botUrl('deleteWebhook'), { drop_pending_updates: false }, { timeout: 15_000 });
    console.log(`[Telegram] deleteWebhook ok pid=${process.pid}`);
  } catch (err: unknown) {
    console.warn(`[Telegram] deleteWebhook failed pid=${process.pid}: ${formatTelegramApiError(err)}`);
  }
}

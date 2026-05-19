import axios from 'axios';
import { isTelegramEnabled, telegramConfig } from '../../config/telegram';

const API_BASE = 'https://api.telegram.org';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number; type: string };
    from?: { id: number; username?: string; first_name?: string };
  };
}

let sendQueue: Promise<void> = Promise.resolve();
let lastSendAt = 0;
const MIN_SEND_INTERVAL_MS = 1000;

function botUrl(method: string): string {
  return `${API_BASE}/bot${telegramConfig.botToken}/${method}`;
}

async function throttleSend(): Promise<void> {
  const wait = Math.max(0, MIN_SEND_INTERVAL_MS - (Date.now() - lastSendAt));
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastSendAt = Date.now();
}

export async function sendTelegramMessage(
  text: string,
  chatId?: string
): Promise<boolean> {
  if (!isTelegramEnabled()) return false;

  const targets = chatId ? [chatId] : telegramConfig.chatIds;
  let anyOk = false;

  for (const id of targets) {
    try {
      await throttleSend();
      const chunks = splitMessage(text, 4000);
      for (const chunk of chunks) {
        await axios.post(botUrl('sendMessage'), {
          chat_id: id,
          text: chunk,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
        if (chunks.length > 1) await throttleSend();
      }
      anyOk = true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Telegram] sendMessage failed chat=${id}:`, msg);
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

export function enqueueTelegramMessage(text: string, chatId?: string): void {
  sendQueue = sendQueue
    .then(async () => {
      await sendTelegramMessage(text, chatId);
    })
    .catch((e) => console.error('[Telegram] queue error:', e));
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
  const res = await axios.get(botUrl('getUpdates'), {
    params,
    timeout: (timeoutSeconds + 10) * 1000,
  });
  return (res.data?.result as TelegramUpdate[]) || [];
}

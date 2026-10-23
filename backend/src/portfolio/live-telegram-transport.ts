import axios from 'axios';
import https from 'node:https';

const agent = new https.Agent({ family: 4, keepAlive: true });
export class LiveTelegramDeliveryError extends Error {
  constructor(readonly reason: string, readonly retryAfterMs = 0, readonly uncertain = false,
    readonly permanent = false) { super(reason); this.name = 'LiveTelegramDeliveryError'; }
}

/** One recipient and one POST. Never log/retain an Axios error containing the bot URL/token. */
export function createLiveTelegramSender(token: string): (chatId: string, text: string) => Promise<string> {
  return async (chatId, text) => {
    if (!token || !chatId || !text.trim() || text.length > 3900) {
      throw new LiveTelegramDeliveryError('telegram_invalid_configuration_or_message', 0, false, true);
    }
    try {
      const response = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: chatId, text, disable_web_page_preview: true,
      }, { timeout: 8_000, httpsAgent: agent });
      if (response.data?.ok === false) {
        const code = response.data.error_code;
        const delay = Number(response.data.parameters?.retry_after);
        throw new LiveTelegramDeliveryError(Number.isSafeInteger(code) ? `telegram_http_${code}` : 'telegram_rejected',
          Number.isFinite(delay) && delay > 0 ? Math.min(delay, 86_400) * 1000 : 0, false, [400, 401, 403].includes(code));
      }
      if (response.data?.ok !== true || !Number.isSafeInteger(response.data?.result?.message_id)
        || response.data.result.message_id <= 0) {
        throw new LiveTelegramDeliveryError('telegram_invalid_acknowledgement', 0, true);
      }
      return String(response.data.result.message_id);
    } catch (error) {
      if (error instanceof LiveTelegramDeliveryError) throw error;
      const failure = error as { response?: { status?: number; data?: { error_code?: number; parameters?: { retry_after?: number } } } };
      const apiCode = failure.response?.data?.error_code, httpCode = failure.response?.status;
      const code = typeof apiCode === 'number' && Number.isSafeInteger(apiCode) ? apiCode
        : typeof httpCode === 'number' && Number.isSafeInteger(httpCode) ? httpCode : undefined;
      const delay = Number(failure.response?.data?.parameters?.retry_after);
      throw new LiveTelegramDeliveryError(code ? `telegram_http_${code}` : 'telegram_delivery_unconfirmed',
        Number.isFinite(delay) && delay > 0 ? Math.min(delay, 86_400) * 1000 : 0,
        !failure.response || (code !== undefined && code >= 500), code === 400 || code === 401 || code === 403);
    }
  };
}

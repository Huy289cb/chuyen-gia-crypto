import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({ default: { post } }));
import { createLiveTelegramSender, LiveTelegramDeliveryError } from '../../src/portfolio/live-telegram-transport';

const token = '123456789:PRIVATE_BOT_TOKEN_FOR_UNIT_TEST_ONLY';
const chat = '-100123456789';
const text = 'Actual-fill notification fixture';
const send = createLiveTelegramSender(token);

beforeEach(() => { post.mockReset(); });

describe('isolated live Telegram delivery transport', () => {
  it('acknowledges one recipient only after a positive Telegram message ID and performs one bounded IPv4 POST', async () => {
    post.mockResolvedValue({ data: { ok: true, result: { message_id: 123 } } });
    expect(await send(chat, text)).toBe('123');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    expect(post.mock.calls[0][1]).toEqual({ chat_id: chat, text, disable_web_page_preview: true });
    expect(post.mock.calls[0][2].timeout).toBe(8000);
    expect(post.mock.calls[0][2].httpsAgent.options.family).toBe(4);
    expect(post.mock.calls[0][1]).not.toHaveProperty('parse_mode');
  });

  it('rejects unusable configuration and oversized or blank messages without a network request', async () => {
    for (const attempt of [
      () => createLiveTelegramSender('')(chat, text),
      () => send('', text),
      () => send(chat, '  '),
      () => send(chat, 'x'.repeat(3901)),
    ]) await expect(attempt()).rejects.toMatchObject({
      reason: 'telegram_invalid_configuration_or_message', permanent: true, uncertain: false,
    });
    expect(post).not.toHaveBeenCalled();
  });

  it.each([undefined, '123', 0, -1, 9007199254740992, NaN])('does not mark an invalid message ID %s as delivered', async messageId => {
    post.mockResolvedValue({ data: { ok: true, result: { message_id: messageId } } });
    await expect(send(chat, text)).rejects.toMatchObject({
      reason: 'telegram_invalid_acknowledgement', uncertain: true, permanent: false,
    });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403])('treats an explicit %i rejection as permanent, retaining no raw response', async code => {
    post.mockRejectedValue({ response: { status: code, data: { error_code: code, description: `PRIVATE ${token} ${chat}` } } });
    const failure = await send(chat, text).catch(error => error);
    expect(failure).toBeInstanceOf(LiveTelegramDeliveryError);
    expect(failure).toMatchObject({ reason: `telegram_http_${code}`, permanent: true, uncertain: false });
    expect(String(failure)).not.toContain(token);
    expect(JSON.stringify(failure)).not.toContain(chat);
    expect(failure.cause).toBeUndefined();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('returns Telegram retry_after for a 429 so the durable outbox, rather than the transport, retries', async () => {
    post.mockRejectedValue({ response: { status: 429, data: { error_code: 429, parameters: { retry_after: 37 } } } });
    await expect(send(chat, text)).rejects.toMatchObject({
      reason: 'telegram_http_429', retryAfterMs: 37000, permanent: false, uncertain: false,
    });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('also reads an explicit rejection body on HTTP 200 without pretending to acknowledge it', async () => {
    post.mockResolvedValue({ data: { ok: false, error_code: 429, parameters: { retry_after: 5 }, description: token } });
    await expect(send(chat, text)).rejects.toMatchObject({
      reason: 'telegram_http_429', retryAfterMs: 5000, permanent: false, uncertain: false,
    });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('marks timeouts as uncertain and redacts the Axios URL, token, recipient and credentials without retrying', async () => {
    const privateUrl = `https://api.telegram.org/bot${token}/sendMessage`;
    post.mockRejectedValue(Object.assign(new Error(`timeout ${privateUrl} secret=PRIVATE_SECRET chat=${chat}`), {
      code: 'ECONNABORTED', config: { url: privateUrl, data: { chat_id: chat, text } },
    }));
    const failure = await send(chat, text).catch(error => error);
    expect(failure).toMatchObject({ reason: 'telegram_delivery_unconfirmed', uncertain: true, permanent: false });
    for (const value of [String(failure), JSON.stringify(failure), String(failure.stack)]) {
      expect(value).not.toContain(token);
      expect(value).not.toContain(chat);
      expect(value).not.toContain('PRIVATE_SECRET');
      expect(value).not.toContain('api.telegram.org');
    }
    expect(failure.cause).toBeUndefined();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('marks a server failure uncertain and accepts only numeric status data for safe diagnostics', async () => {
    post.mockRejectedValue({ response: { status: 503, data: { error_code: `PRIVATE ${token} ${chat}`, description: token } } });
    const failure = await send(chat, text).catch(error => error);
    expect(failure).toMatchObject({ reason: 'telegram_http_503', uncertain: true, permanent: false });
    expect(JSON.stringify(failure)).not.toContain(token);
    expect(JSON.stringify(failure)).not.toContain(chat);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it.each([Infinity, 'bad', 1e308, -1])('never persists a nonfinite or negative retry delay from %s', async retryAfter => {
    post.mockRejectedValue({ response: { status: 429, data: { error_code: 429, parameters: { retry_after: retryAfter } } } });
    const failure = await send(chat, text).catch(error => error);
    expect(failure).toBeInstanceOf(LiveTelegramDeliveryError);
    expect(Number.isFinite(failure.retryAfterMs)).toBe(true);
    expect(failure.retryAfterMs).toBeGreaterThanOrEqual(0);
    expect(post).toHaveBeenCalledTimes(1);
  });
});

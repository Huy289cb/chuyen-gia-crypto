/**
 * Unit tests for Binance HTTP retry policy
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAxios = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({
  default: mockAxios,
}));

vi.mock('../../src/services/binance/signer.js', () => ({
  sign: vi.fn(() => 'signed'),
}));

vi.mock('../../src/services/binance/config.js', () => ({
  config: {
    API_KEY: 'key',
    API_SECRET: 'secret',
    BASE_URL: 'https://example.test',
  },
}));

import { requestWithRetry } from '../../src/services/binance/client.js';

describe('Binance HTTP Client Retry Policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not retry -1109 on balance metadata endpoints', async () => {
    mockAxios.mockRejectedValue({
      response: {
        data: {
          code: -1109,
          msg: 'Invalid account.',
        },
      },
    });

    await expect(requestWithRetry('GET', '/fapi/v3/balance', {}, true))
      .rejects
      .toThrow('Binance API Error -1109');

    expect(mockAxios).toHaveBeenCalledTimes(1);
  });

  it('retries transient -1109 on order endpoints', async () => {
    mockAxios
      .mockRejectedValueOnce({
        response: {
          data: {
            code: -1109,
            msg: 'Invalid account.',
          },
        },
      })
      .mockResolvedValueOnce({ data: { orderId: 1 } });

    await expect(requestWithRetry('POST', '/fapi/v1/order', { symbol: 'BTCUSDT' }, true))
      .resolves
      .toEqual({ orderId: 1 });

    expect(mockAxios).toHaveBeenCalledTimes(2);
  });

  it('retries transient -1109 on algo order endpoints', async () => {
    mockAxios
      .mockRejectedValueOnce({
        response: {
          data: {
            code: -1109,
            msg: 'Invalid account.',
          },
        },
      })
      .mockRejectedValueOnce({
        response: {
          data: {
            code: -1109,
            msg: 'Invalid account.',
          },
        },
      })
      .mockResolvedValueOnce({ data: { algoId: 99 } });

    await expect(requestWithRetry('POST', '/fapi/v1/algoOrder', { symbol: 'BTCUSDT' }, true))
      .resolves
      .toEqual({ algoId: 99 });

    expect(mockAxios).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retriable Binance contract errors like -5000', async () => {
    mockAxios.mockRejectedValue({
      response: {
        data: {
          code: -5000,
          msg: 'Path /fapi/v1/order/stopMarket, Method POST is invalid',
        },
      },
    });

    await expect(requestWithRetry('POST', '/fapi/v1/order', { symbol: 'BTCUSDT' }, true))
      .rejects
      .toThrow('Binance API Error -5000');

    expect(mockAxios).toHaveBeenCalledTimes(1);
  });

  it('includes recvWindow on signed requests', async () => {
    mockAxios.mockResolvedValueOnce({ data: { ok: true } });

    await requestWithRetry('GET', '/fapi/v3/balance', {}, true);

    const calledUrl = mockAxios.mock.calls[0][0].url;
    expect(calledUrl).toContain('recvWindow=');
    expect(calledUrl).toContain('timestamp=');
  });

  it('retries transient no-response failures up to the retry limit', async () => {
    mockAxios
      .mockRejectedValueOnce({ request: {} })
      .mockRejectedValueOnce({ request: {} })
      .mockResolvedValueOnce({ data: { ok: true } });

    await expect(requestWithRetry('GET', '/fapi/v1/time'))
      .resolves
      .toEqual({ ok: true });

    expect(mockAxios).toHaveBeenCalledTimes(3);
  });
});

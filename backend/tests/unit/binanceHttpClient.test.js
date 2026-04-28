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

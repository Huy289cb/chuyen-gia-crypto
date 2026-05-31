/**
 * Unit tests for Binance trading adapter
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPost = vi.hoisted(() => vi.fn(() => Promise.resolve({
  orderId: 12345,
  algoId: 12345,
  clientOrderId: 'abc',
  symbol: 'BTCUSDT',
  side: 'SELL',
  type: 'STOP_MARKET',
  status: 'NEW',
})));

vi.mock('../../src/services/binance/client.js', () => ({
  post: mockPost,
  del: vi.fn(),
  get: vi.fn(),
}));

import {
  placeStopMarketOrder,
  placeTakeProfitMarketOrder,
} from '../../src/services/binance/trading.js';

describe('Binance Trading Adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('places stop-market orders via algo order API', async () => {
    await placeStopMarketOrder({
      symbol: 'BTCUSDT',
      side: 'SELL',
      quantity: '0.01',
      stopPrice: '49000',
      positionSide: 'LONG',
      closePosition: true,
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/fapi/v1/algoOrder',
      expect.objectContaining({
        symbol: 'BTCUSDT',
        side: 'SELL',
        quantity: '0.01',
        triggerPrice: '49000',
        positionSide: 'LONG',
        closePosition: true,
        algoType: 'CONDITIONAL',
        type: 'STOP_MARKET',
      }),
      true
    );
  });

  it('places take-profit-market orders via algo order API', async () => {
    await placeTakeProfitMarketOrder({
      symbol: 'BTCUSDT',
      side: 'SELL',
      quantity: '0.01',
      stopPrice: '52000',
      positionSide: 'LONG',
      closePosition: true,
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/fapi/v1/algoOrder',
      expect.objectContaining({
        symbol: 'BTCUSDT',
        side: 'SELL',
        quantity: '0.01',
        triggerPrice: '52000',
        positionSide: 'LONG',
        closePosition: true,
        algoType: 'CONDITIONAL',
        type: 'TAKE_PROFIT_MARKET',
      }),
      true
    );
  });
});

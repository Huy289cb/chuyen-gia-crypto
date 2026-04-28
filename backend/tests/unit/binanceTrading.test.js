/**
 * Unit tests for Binance trading adapter
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPost = vi.hoisted(() => vi.fn(() => Promise.resolve({
  orderId: 12345,
  clientOrderId: 'abc',
  symbol: 'BTCUSDT',
  side: 'SELL',
  type: 'STOP_MARKET',
  price: '0',
  stopPrice: '49000',
  origQty: '0.01',
  executedQty: '0',
  cummulativeQuoteQty: '0',
  status: 'NEW',
  timeInForce: 'GTC',
  transactTime: 123,
  updateTime: 123,
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

  it('places stop-market orders via the standard order endpoint with type=STOP_MARKET', async () => {
    await placeStopMarketOrder({
      symbol: 'BTCUSDT',
      side: 'SELL',
      quantity: '0.01',
      stopPrice: '49000',
      positionSide: 'LONG',
      closePosition: true,
    });

    expect(mockPost).toHaveBeenCalledWith('/fapi/v1/order', {
      symbol: 'BTCUSDT',
      side: 'SELL',
      quantity: '0.01',
      stopPrice: '49000',
      positionSide: 'LONG',
      closePosition: true,
      type: 'STOP_MARKET',
    }, true);
  });

  it('places take-profit-market orders via the standard order endpoint with type=TAKE_PROFIT_MARKET', async () => {
    await placeTakeProfitMarketOrder({
      symbol: 'BTCUSDT',
      side: 'SELL',
      quantity: '0.01',
      stopPrice: '52000',
      positionSide: 'LONG',
      closePosition: true,
    });

    expect(mockPost).toHaveBeenCalledWith('/fapi/v1/order', {
      symbol: 'BTCUSDT',
      side: 'SELL',
      quantity: '0.01',
      stopPrice: '52000',
      positionSide: 'LONG',
      closePosition: true,
      type: 'TAKE_PROFIT_MARKET',
    }, true);
  });
});

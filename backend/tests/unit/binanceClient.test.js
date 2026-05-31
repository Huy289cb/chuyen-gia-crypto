/**
 * Unit tests for Binance REST client service wrapper
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockValidateConfig = vi.hoisted(() => vi.fn(() => true));
const mockGetServerTime = vi.hoisted(() => vi.fn(() => Promise.resolve(1234567890)));
const mockGetBalance = vi.hoisted(() => vi.fn(() => Promise.resolve({
  walletBalance: 1000,
  availableBalance: 950,
  totalWalletBalance: 1000,
  totalUnrealizedProfit: 50,
})));
const mockGetCurrentPosition = vi.hoisted(() => vi.fn(() => Promise.resolve({
  symbol: 'BTCUSDT',
  positionAmt: 0.01,
  entryPrice: 50000,
  markPrice: 51000,
  unRealizedProfit: 10,
})));
const mockGetPositionRisk = vi.hoisted(() => vi.fn(() => Promise.resolve([])));
const mockPlaceOrder = vi.hoisted(() => vi.fn(() => Promise.resolve({
  orderId: 12345,
  symbol: 'BTCUSDT',
  side: 'BUY',
  type: 'MARKET',
  price: null,
  stopPrice: null,
  executedQty: 0.01,
  status: 'FILLED',
})));
const mockPlaceStopMarketOrder = vi.hoisted(() => vi.fn(() => Promise.resolve({
  orderId: 12346,
  symbol: 'BTCUSDT',
  side: 'SELL',
  type: 'STOP_MARKET',
  stopPrice: 49000,
  status: 'NEW',
})));
const mockPlaceTakeProfitMarketOrder = vi.hoisted(() => vi.fn(() => Promise.resolve({
  orderId: 12347,
  symbol: 'BTCUSDT',
  side: 'SELL',
  type: 'TAKE_PROFIT_MARKET',
  stopPrice: 52000,
  status: 'NEW',
})));
const mockCancelOrder = vi.hoisted(() => vi.fn(() => Promise.resolve({ orderId: 12345, symbol: 'BTCUSDT', status: 'CANCELED' })));
const mockCancelAllOrders = vi.hoisted(() => vi.fn(() => Promise.resolve([])));
const mockGetOpenOrders = vi.hoisted(() => vi.fn(() => Promise.resolve([])));
const mockSetLeverage = vi.hoisted(() => vi.fn(() => Promise.resolve({ symbol: 'BTCUSDT', leverage: 5 })));
const mockSetMarginType = vi.hoisted(() => vi.fn(() => Promise.resolve({ symbol: 'BTCUSDT', marginType: 'ISOLATED' })));

const mockGetExchangeInfo = vi.hoisted(() => vi.fn(() => Promise.resolve({
  symbols: [{
    symbol: 'BTCUSDT',
    filters: [
      { filterType: 'LOT_SIZE', stepSize: '0.001', minQty: '0.001', maxQty: '1000' },
      { filterType: 'PRICE_FILTER', tickSize: '0.1', minPrice: '0.1', maxPrice: '1000000' },
      { filterType: 'MIN_NOTIONAL', minNotional: '5' },
    ],
  }],
})));

vi.mock('../../src/services/binance/client.js', () => ({
  get: mockGetExchangeInfo,
}));

vi.mock('../../src/services/binance-hedge-mode.js', () => ({
  ensurePositionModeDetected: vi.fn().mockResolvedValue('HEDGE'),
  getPositionMode: vi.fn(() => 'HEDGE'),
  resolvePositionSide: vi.fn(() => 'LONG'),
  validatePositionSide: vi.fn(),
}));

vi.mock('../../src/services/binance/config.js', () => ({
  validateConfig: mockValidateConfig,
}));

vi.mock('../../src/services/binance/market.js', () => ({
  getServerTime: mockGetServerTime,
}));

vi.mock('../../src/services/binance/account.js', () => ({
  getBalance: mockGetBalance,
  getCurrentPosition: mockGetCurrentPosition,
  getPositionRisk: mockGetPositionRisk,
}));

vi.mock('../../src/services/binance/trading.js', () => ({
  placeOrder: mockPlaceOrder,
  testOrder: vi.fn(),
  cancelOrder: mockCancelOrder,
  cancelAllOrders: mockCancelAllOrders,
  getOpenOrders: mockGetOpenOrders,
  setLeverage: mockSetLeverage,
  setMarginType: mockSetMarginType,
  placeStopMarketOrder: mockPlaceStopMarketOrder,
  placeTakeProfitMarketOrder: mockPlaceTakeProfitMarketOrder,
  cancelAlgoOrder: vi.fn(),
  cancelAllAlgoOrders: vi.fn(),
}));

import {
  cancelAllOrders,
  cancelOrder,
  getAccountBalance,
  getCurrentPosition,
  getOpenOrders,
  getPositionRisk,
  initTestnetClient,
  placeLimitOrder,
  placeMarketOrder,
  placeStopLossOrder,
  placeTakeProfitOrder,
  setLeverage,
  setMarginType,
  testConnection,
} from '../../src/services/binanceClient.js';

describe('Binance REST Client Wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateConfig.mockReturnValue(true);
  });

  it('returns null when config validation fails', () => {
    mockValidateConfig.mockReturnValue(false);
    expect(initTestnetClient()).toBeNull();
  });

  it('returns an object when config validation succeeds', () => {
    expect(initTestnetClient()).toEqual({});
  });

  it('tests connection via server time', async () => {
    expect(await testConnection({})).toEqual({ success: true, serverTime: 1234567890 });
  });

  it('returns account balance from REST account module', async () => {
    const balance = await getAccountBalance({});
    expect(balance.walletBalance).toBe(1000);
    expect(balance.totalUnrealizedProfit).toBe(50);
  });

  it('returns current position from REST account module', async () => {
    const position = await getCurrentPosition({}, 'BTCUSDT');
    expect(position.symbol).toBe('BTCUSDT');
    expect(position.positionAmt).toBe(0.01);
  });

  it('places a market order through placeOrder', async () => {
    await placeMarketOrder({}, 'BTCUSDT', 'BUY', 0.01, 'OPEN', null, 'LONG');

    expect(mockPlaceOrder).toHaveBeenCalledWith({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: '0.01',
      positionSide: 'LONG',
    });
  });

  it('places a limit order through placeOrder', async () => {
    await placeLimitOrder({}, 'BTCUSDT', 'BUY', 0.01, 50000, 'OPEN', null, 'LONG');

    expect(mockPlaceOrder).toHaveBeenCalledWith({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity: '0.01',
      price: '50000',
      timeInForce: 'GTC',
      positionSide: 'LONG',
    });
  });

  it('places hedge-mode stop loss through conditional order adapter', async () => {
    await placeStopLossOrder({}, 'BTCUSDT', 'SELL', 0.01, 49000, 'CLOSE', { positionAmt: 0.01, positionSide: 'LONG' }, 'LONG');

    expect(mockPlaceStopMarketOrder).toHaveBeenCalledWith({
      symbol: 'BTCUSDT',
      side: 'SELL',
      quantity: '0.01',
      stopPrice: '49000',
      positionSide: 'LONG',
      closePosition: true,
    });
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it('places hedge-mode take profit through conditional order adapter', async () => {
    await placeTakeProfitOrder({}, 'BTCUSDT', 'SELL', 0.01, 52000, 'CLOSE', { positionAmt: 0.01, positionSide: 'LONG' }, 'LONG');

    expect(mockPlaceTakeProfitMarketOrder).toHaveBeenCalledWith({
      symbol: 'BTCUSDT',
      side: 'SELL',
      quantity: '0.01',
      stopPrice: '52000',
      positionSide: 'LONG',
      closePosition: true,
    });
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it('places one-way stop loss via algo order (Demo/mainnet)', async () => {
    const hedge = await import('../../src/services/binance-hedge-mode.js');
    vi.mocked(hedge.getPositionMode).mockReturnValue('ONE_WAY');
    vi.mocked(hedge.resolvePositionSide).mockReturnValue(null);

    await placeStopLossOrder({}, 'BTCUSDT', 'SELL', 0.01, 49000, 'CLOSE', { positionAmt: 0.01 });

    expect(mockPlaceStopMarketOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        side: 'SELL',
        stopPrice: '49000',
        positionSide: 'BOTH',
        reduceOnly: true,
      })
    );
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it('places one-way take profit via algo order (Demo/mainnet)', async () => {
    const hedge = await import('../../src/services/binance-hedge-mode.js');
    vi.mocked(hedge.getPositionMode).mockReturnValue('ONE_WAY');
    vi.mocked(hedge.resolvePositionSide).mockReturnValue(null);

    await placeTakeProfitOrder({}, 'BTCUSDT', 'SELL', 0.01, 52000, 'CLOSE', { positionAmt: 0.01 });

    expect(mockPlaceTakeProfitMarketOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        side: 'SELL',
        stopPrice: '52000',
        positionSide: 'BOTH',
        reduceOnly: true,
      })
    );
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it('cancels and fetches orders through REST trading module', async () => {
    await cancelOrder({}, 'BTCUSDT', 12345);
    await cancelAllOrders({}, 'BTCUSDT');
    await getOpenOrders({}, 'BTCUSDT');
    await getPositionRisk({}, 'BTCUSDT');
    await setLeverage({}, 'BTCUSDT', 5);
    await setMarginType({}, 'BTCUSDT', 'ISOLATED');

    expect(mockCancelOrder).toHaveBeenCalledWith('BTCUSDT', 12345);
    expect(mockCancelAllOrders).toHaveBeenCalledWith('BTCUSDT');
    expect(mockGetOpenOrders).toHaveBeenCalledWith('BTCUSDT');
    expect(mockGetPositionRisk).toHaveBeenCalledWith('BTCUSDT');
    expect(mockSetLeverage).toHaveBeenCalledWith('BTCUSDT', 5);
    expect(mockSetMarginType).toHaveBeenCalledWith('BTCUSDT', 'ISOLATED');
  });
});

/**
 * Unit tests for Binance Client Service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initTestnetClient,
  testConnection,
  getAccountBalance,
  getCurrentPosition,
  placeMarketOrder,
  placeLimitOrder,
  placeStopLossOrder,
  placeTakeProfitOrder,
  cancelOrder,
  cancelAllOrders,
  getOpenOrders,
  getPositionRisk,
  setLeverage,
  setMarginType,
} from '../../src/services/binanceClient.js';

// Mock binance package
vi.mock('binance', () => ({
  USDMClient: vi.fn().mockImplementation(() => ({
    getServerTime: vi.fn().mockResolvedValue({ serverTime: 1234567890 }),
    getAccount: vi.fn().mockResolvedValue({
      assets: [{ asset: 'USDT', walletBalance: '1000.00', availableBalance: '950.00' }],
      totalWalletBalance: '1000.00',
      totalUnrealizedProfit: '50.00',
    }),
    getPositionRisk: vi.fn().mockResolvedValue([
      {
        symbol: 'BTCUSDT',
        positionAmt: '0.01',
        entryPrice: '50000.00',
        markPrice: '51000.00',
        unRealizedProfit: '10.00',
        leverage: '1',
        positionSide: 'LONG',
      }
    ]),
    submitOrder: vi.fn().mockResolvedValue({
      orderId: 12345,
      clientOrderId: 'client123',
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      transactTime: 1234567890,
      executedQty: '0.01',
      cummulativeQuoteQty: '500.00',
      status: 'FILLED',
    }),
    cancelOrder: vi.fn().mockResolvedValue({
      orderId: 12345,
      symbol: 'BTCUSDT',
      status: 'CANCELED',
    }),
    cancelAllOrders: vi.fn().mockResolvedValue([]),
    getOpenOrders: vi.fn().mockResolvedValue([
      {
        orderId: 12345,
        clientOrderId: 'client123',
        symbol: 'BTCUSDT',
        side: 'BUY',
        type: 'LIMIT',
        origQty: '0.01',
        price: '50000.00',
        stopPrice: '0',
        status: 'NEW',
        timeInForce: 'GTC',
        updateTime: 1234567890,
      }
    ]),
    setLeverage: vi.fn().mockResolvedValue({
      symbol: 'BTCUSDT',
      leverage: '1',
      maxNotionalValue: '1000000',
    }),
    setMarginType: vi.fn().mockResolvedValue({ symbol: 'BTCUSDT', marginType: 'ISOLATED' }),
  }))
}));

describe('Binance Client', () => {
  beforeEach(() => {
    // Reset environment variables
    process.env.BINANCE_TESTNET_ENABLED = 'true';
    process.env.BINANCE_TESTNET_API_KEY = 'test_api_key';
    process.env.BINANCE_TESTNET_SECRET_KEY = 'test_secret_key';
  });

  describe('initTestnetClient', () => {
    it('should return null when testnet is disabled', () => {
      process.env.BINANCE_TESTNET_ENABLED = 'false';
      const client = initTestnetClient();
      expect(client).toBeNull();
    });

    it('should return null when API key is missing', () => {
      process.env.BINANCE_TESTNET_API_KEY = '';
      const client = initTestnetClient();
      expect(client).toBeNull();
    });

    it('should return null when secret key is missing', () => {
      process.env.BINANCE_TESTNET_SECRET_KEY = '';
      const client = initTestnetClient();
      expect(client).toBeNull();
    });

    it('should return client instance when config is valid', () => {
      const client = initTestnetClient();
      expect(client).not.toBeNull();
      expect(client).toHaveProperty('serverTime');
      expect(client).toHaveProperty('account');
    });
  });

  describe('testConnection', () => {
    it('should return success when connection works', async () => {
      const client = initTestnetClient();
      const result = await testConnection(client);
      expect(result.success).toBe(true);
      expect(result.serverTime).toBe(1234567890);
    });

    it('should return error when client is null', async () => {
      const result = await testConnection(null);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Client not initialized');
    });
  });

  describe('getAccountBalance', () => {
    it('should return balance data', async () => {
      const client = initTestnetClient();
      const balance = await getAccountBalance(client);
      expect(balance.walletBalance).toBe(1000.00);
      expect(balance.availableBalance).toBe(950.00);
      expect(balance.totalWalletBalance).toBe(1000.00);
      expect(balance.totalUnrealizedProfit).toBe(50.00);
    });

    it('should throw error when client is null', async () => {
      await expect(getAccountBalance(null)).rejects.toThrow('Client not initialized');
    });
  });

  describe('getCurrentPosition', () => {
    it('should return position data', async () => {
      const client = initTestnetClient();
      const position = await getCurrentPosition(client, 'BTCUSDT');
      expect(position).not.toBeNull();
      expect(position.symbol).toBe('BTCUSDT');
      expect(position.positionAmt).toBe(0.01);
      expect(position.entryPrice).toBe(50000.00);
      expect(position.markPrice).toBe(51000.00);
      expect(position.unRealizedProfit).toBe(10.00);
    });

    it('should return null when no position exists', async () => {
      const client = initTestnetClient();
      // Mock empty position response
      client.getPositionRisk = vi.fn().mockResolvedValue({ data: [] });
      const position = await getCurrentPosition(client, 'BTCUSDT');
      expect(position).toBeNull();
    });

    it('should throw error when client is null', async () => {
      await expect(getCurrentPosition(null, 'BTCUSDT')).rejects.toThrow('Client not initialized');
    });
  });

  describe('placeMarketOrder', () => {
    it('should place market order successfully', async () => {
      const client = initTestnetClient();
      const order = await placeMarketOrder(client, 'BTCUSDT', 'BUY', 0.01);
      expect(order.orderId).toBe(12345);
      expect(order.symbol).toBe('BTCUSDT');
      expect(order.side).toBe('BUY');
      expect(order.type).toBe('MARKET');
      expect(order.executedQty).toBe(0.01);
    });

    it('should throw error when client is null', async () => {
      await expect(placeMarketOrder(null, 'BTCUSDT', 'BUY', 0.01)).rejects.toThrow('Client not initialized');
    });
  });

  describe('placeLimitOrder', () => {
    it('should place limit order successfully', async () => {
      const client = initTestnetClient();
      const order = await placeLimitOrder(client, 'BTCUSDT', 'BUY', 0.01, 50000);
      expect(order.orderId).toBe(12345);
      expect(order.symbol).toBe('BTCUSDT');
      expect(order.side).toBe('BUY');
      expect(order.type).toBe('LIMIT');
      expect(order.price).toBe(50000);
    });

    it('should throw error when client is null', async () => {
      await expect(placeLimitOrder(null, 'BTCUSDT', 'BUY', 0.01, 50000)).rejects.toThrow('Client not initialized');
    });
  });

  describe('placeStopLossOrder', () => {
    it('should place stop loss order successfully', async () => {
      const client = initTestnetClient();
      const order = await placeStopLossOrder(client, 'BTCUSDT', 'SELL', 0.01, 49000);
      expect(order.orderId).toBe(12345);
      expect(order.symbol).toBe('BTCUSDT');
      expect(order.side).toBe('SELL');
      expect(order.type).toBe('STOP_MARKET');
      expect(order.stopPrice).toBe(49000);
    });

    it('should throw error when client is null', async () => {
      await expect(placeStopLossOrder(null, 'BTCUSDT', 'SELL', 0.01, 49000)).rejects.toThrow('Client not initialized');
    });
  });

  describe('placeTakeProfitOrder', () => {
    it('should place take profit order successfully', async () => {
      const client = initTestnetClient();
      const order = await placeTakeProfitOrder(client, 'BTCUSDT', 'SELL', 0.01, 52000);
      expect(order.orderId).toBe(12345);
      expect(order.symbol).toBe('BTCUSDT');
      expect(order.side).toBe('SELL');
      expect(order.type).toBe('TAKE_PROFIT_MARKET');
      expect(order.stopPrice).toBe(52000);
    });

    it('should throw error when client is null', async () => {
      await expect(placeTakeProfitOrder(null, 'BTCUSDT', 'SELL', 0.01, 52000)).rejects.toThrow('Client not initialized');
    });
  });

  describe('cancelOrder', () => {
    it('should cancel order successfully', async () => {
      const client = initTestnetClient();
      const result = await cancelOrder(client, 'BTCUSDT', 12345);
      expect(result.orderId).toBe(12345);
      expect(result.symbol).toBe('BTCUSDT');
      expect(result.status).toBe('CANCELED');
    });

    it('should throw error when client is null', async () => {
      await expect(cancelOrder(null, 'BTCUSDT', 12345)).rejects.toThrow('Client not initialized');
    });
  });

  describe('cancelAllOrders', () => {
    it('should cancel all orders successfully', async () => {
      const client = initTestnetClient();
      const result = await cancelAllOrders(client, 'BTCUSDT');
      expect(result).toEqual([]);
    });

    it('should throw error when client is null', async () => {
      await expect(cancelAllOrders(null, 'BTCUSDT')).rejects.toThrow('Client not initialized');
    });
  });

  describe('getOpenOrders', () => {
    it('should return open orders', async () => {
      const client = initTestnetClient();
      const orders = await getOpenOrders(client, 'BTCUSDT');
      expect(orders).toHaveLength(1);
      expect(orders[0].orderId).toBe(12345);
      expect(orders[0].symbol).toBe('BTCUSDT');
      expect(orders[0].side).toBe('BUY');
      expect(orders[0].type).toBe('LIMIT');
    });

    it('should throw error when client is null', async () => {
      await expect(getOpenOrders(null, 'BTCUSDT')).rejects.toThrow('Client not initialized');
    });
  });

  describe('getPositionRisk', () => {
    it('should return position risk data', async () => {
      const client = initTestnetClient();
      const risks = await getPositionRisk(client, 'BTCUSDT');
      expect(risks).toHaveLength(1);
      expect(risks[0].symbol).toBe('BTCUSDT');
      expect(risks[0].positionAmt).toBe(0.01);
      expect(risks[0].leverage).toBe(1);
    });

    it('should throw error when client is null', async () => {
      await expect(getPositionRisk(null, 'BTCUSDT')).rejects.toThrow('Client not initialized');
    });
  });

  describe('setLeverage', () => {
    it('should set leverage successfully', async () => {
      const client = initTestnetClient();
      const result = await setLeverage(client, 'BTCUSDT', 5);
      expect(result.symbol).toBe('BTCUSDT');
      expect(result.leverage).toBe(5);
    });

    it('should throw error when client is null', async () => {
      await expect(setLeverage(null, 'BTCUSDT', 5)).rejects.toThrow('Client not initialized');
    });
  });

  describe('setMarginType', () => {
    it('should set margin type successfully', async () => {
      const client = initTestnetClient();
      const result = await setMarginType(client, 'BTCUSDT', 'ISOLATED');
      expect(result).toBeDefined();
    });

    it('should throw error when client is null', async () => {
      await expect(setMarginType(null, 'BTCUSDT', 'ISOLATED')).rejects.toThrow('Client not initialized');
    });
  });
});

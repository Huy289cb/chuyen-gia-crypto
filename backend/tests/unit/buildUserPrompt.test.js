import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildUserPrompt } from '../../src/analyzers/analyzerFactory.js';

// Mock database functions
vi.mock('../../src/db/database.js', () => ({
  getRecentAnalysisWithPredictions: vi.fn(),
  getPositions: vi.fn(),
  getPendingOrders: vi.fn(),
  getOHLCCandles: vi.fn()
}));

// Mock getMethodConfig
vi.mock('../../src/config/methods.js', () => ({
  getMethodConfig: vi.fn(() => ({
    name: 'Kim Nghia',
    methodId: 'kim_nghia'
  }))
}));

describe('buildUserPrompt', () => {
  const mockPriceData = {
    btc: {
      price: 75000,
      change24h: 2.5,
      change7d: 5.0,
      sparkline7d: [74000, 74100, 74200, 74300, 74400, 74500, 74600, 74700, 74800, 74900, 75000],
      prices1h: [74800, 74850, 74900, 74950, 75000],
      prices4h: [74500, 74600, 74700, 74800, 74900, 75000],
      prices1d: [74000, 74100, 74200, 74300, 74400, 74500, 74600, 74700, 74800, 74900, 75000]
    }
  };

  const mockDb = {};

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetching open positions', () => {
    it('should fetch open positions with correct filters', async () => {
      const { getPositions } = await import('../../src/db/database.js');
      getPositions.mockResolvedValue([]);

      await buildUserPrompt(mockPriceData, mockDb, 'kim_nghia');

      expect(getPositions).toHaveBeenCalledWith(
        mockDb,
        { symbol: 'BTC', status: 'open', method_id: 'kim_nghia' }
      );
    });

    it('should format positions with PnL, time-in-position, and risk info', async () => {
      const { getPositions } = await import('../../src/db/database.js');
      const mockPositions = [
        {
          position_id: 'pos_123',
          side: 'long',
          entry_price: 74000,
          stop_loss: 73500,
          take_profit: 76000,
          size_usd: 1000,
          size_qty: 0.0135,
          entry_time: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
        }
      ];
      getPositions.mockResolvedValue(mockPositions);

      const prompt = await buildUserPrompt(mockPriceData, mockDb, 'kim_nghia');

      expect(prompt).toContain('OPEN BTC POSITIONS:');
      expect(prompt).toContain('Position ID: pos_123');
      expect(prompt).toContain('LONG');
      expect(prompt).toContain('Entry $74,000');
      expect(prompt).toContain('SL $73,500');
      expect(prompt).toContain('TP $76,000');
      expect(prompt).toContain('PnL:');
      expect(prompt).toContain('Risk:');
      expect(prompt).toContain('Time in position:');
    });

    it('should include position_decisions instruction when positions exist', async () => {
      const { getPositions } = await import('../../src/db/database.js');
      getPositions.mockResolvedValue([
        {
          position_id: 'pos_123',
          side: 'long',
          entry_price: 74000,
          stop_loss: 73500,
          take_profit: 76000,
          size_qty: 0.1,
          size_usd: 7400,
          entry_time: new Date(Date.now() - 3600000).toISOString()
        }
      ]);

      const prompt = await buildUserPrompt(mockPriceData, mockDb, 'kim_nghia');

      expect(prompt).toContain('position_decisions');
      expect(prompt).toContain('position_id from above');
    });

    it('should handle empty positions gracefully', async () => {
      const { getPositions } = await import('../../src/db/database.js');
      getPositions.mockResolvedValue([]);

      const prompt = await buildUserPrompt(mockPriceData, mockDb, 'kim_nghia');

      expect(prompt).not.toContain('OPEN BTC POSITIONS:');
      expect(prompt).not.toContain('position_decisions');
    });

    it('should handle database errors gracefully', async () => {
      const { getPositions } = await import('../../src/db/database.js');
      getPositions.mockRejectedValue(new Error('Database error'));

      const prompt = await buildUserPrompt(mockPriceData, mockDb, 'kim_nghia');

      // Should still return a prompt without positions
      expect(prompt).toBeDefined();
      expect(prompt).toContain('BTC DATA:');
    });
  });

  describe('fetching pending orders', () => {
    it('should fetch pending orders with correct filters', async () => {
      const { getPendingOrders } = await import('../../src/db/database.js');
      getPendingOrders.mockResolvedValue([]);

      await buildUserPrompt(mockPriceData, mockDb, 'kim_nghia');

      expect(getPendingOrders).toHaveBeenCalledWith(
        mockDb,
        { symbol: 'BTC', status: 'pending', method_id: 'kim_nghia' }
      );
    });

    it('should format pending orders with price distance, waiting time, and R:R', async () => {
      const { getPendingOrders } = await import('../../src/db/database.js');
      const mockOrders = [
        {
          order_id: 'ord_456',
          side: 'long',
          entry_price: 73500,
          stop_loss: 73000,
          take_profit: 75500,
          size_usd: 500,
          risk_percent: 0.67,
          expected_rr: 2.5,
          created_at: new Date(Date.now() - 7200000).toISOString() // 2 hours ago
        }
      ];
      getPendingOrders.mockResolvedValue(mockOrders);

      const prompt = await buildUserPrompt(mockPriceData, mockDb, 'kim_nghia');

      expect(prompt).toContain('PENDING BTC LIMIT ORDERS:');
      expect(prompt).toContain('Order ID: ord_456');
      expect(prompt).toContain('LONG');
      expect(prompt).toContain('Entry $73,500');
      expect(prompt).toContain('SL $73,000');
      expect(prompt).toContain('TP $75,500');
      expect(prompt).toContain('Price Diff:');
      expect(prompt).toContain('Waiting:');
      expect(prompt).toContain('Risk:');
      expect(prompt).toContain('R:R');
    });

    it('should include pending_order_decisions instruction when orders exist', async () => {
      const { getPendingOrders } = await import('../../src/db/database.js');
      getPendingOrders.mockResolvedValue([
        {
          order_id: 'ord_456',
          side: 'long',
          entry_price: 73500,
          stop_loss: 73000,
          take_profit: 75500,
          size_usd: 500,
          risk_percent: 0.67,
          expected_rr: 2.5,
          created_at: new Date(Date.now() - 7200000).toISOString()
        }
      ]);

      const prompt = await buildUserPrompt(mockPriceData, mockDb, 'kim_nghia');

      expect(prompt).toContain('pending_order_decisions');
      expect(prompt).toContain('order_id from above');
    });

    it('should handle empty orders gracefully', async () => {
      const { getPendingOrders } = await import('../../src/db/database.js');
      getPendingOrders.mockResolvedValue([]);

      const prompt = await buildUserPrompt(mockPriceData, mockDb, 'kim_nghia');

      expect(prompt).not.toContain('PENDING BTC LIMIT ORDERS:');
      expect(prompt).not.toContain('pending_order_decisions');
    });

    it('should handle database errors gracefully', async () => {
      const { getPendingOrders } = await import('../../src/db/database.js');
      getPendingOrders.mockRejectedValue(new Error('Database error'));

      const prompt = await buildUserPrompt(mockPriceData, mockDb, 'kim_nghia');

      // Should still return a prompt without orders
      expect(prompt).toBeDefined();
      expect(prompt).toContain('BTC DATA:');
    });
  });

  describe('prompt structure', () => {
    it('should include basic BTC data', async () => {
      const { getPositions, getPendingOrders } = await import('../../src/db/database.js');
      getPositions.mockResolvedValue([]);
      getPendingOrders.mockResolvedValue([]);

      const prompt = await buildUserPrompt(mockPriceData, mockDb, 'kim_nghia');

      expect(prompt).toContain('BTC DATA:');
      expect(prompt).toContain('Current Price: $75,000');
      expect(prompt).toContain('24h Change: 2.50%');
      expect(prompt).toContain('7d Change: 5.00%');
    });

    it('should include timeframe changes', async () => {
      const { getPositions, getPendingOrders } = await import('../../src/db/database.js');
      getPositions.mockResolvedValue([]);
      getPendingOrders.mockResolvedValue([]);

      const prompt = await buildUserPrompt(mockPriceData, mockDb, 'kim_nghia');

      expect(prompt).toContain('Timeframe Changes:');
      expect(prompt).toContain('15m=');
      expect(prompt).toContain('1h=');
      expect(prompt).toContain('4h=');
      expect(prompt).toContain('1d=');
    });

    it('should include method name in prompt', async () => {
      const { getPositions, getPendingOrders } = await import('../../src/db/database.js');
      getPositions.mockResolvedValue([]);
      getPendingOrders.mockResolvedValue([]);

      const prompt = await buildUserPrompt(mockPriceData, mockDb, 'kim_nghia');

      expect(prompt).toContain('Kim Nghia');
    });

    it('should mention BTC-only mode', async () => {
      const { getPositions, getPendingOrders } = await import('../../src/db/database.js');
      getPositions.mockResolvedValue([]);
      getPendingOrders.mockResolvedValue([]);

      const prompt = await buildUserPrompt(mockPriceData, mockDb, 'kim_nghia');

      expect(prompt).toContain('BTC-only mode');
    });
  });

  describe('without database', () => {
    it('should work without database connection', async () => {
      const prompt = await buildUserPrompt(mockPriceData, null, 'kim_nghia');

      expect(prompt).toBeDefined();
      expect(prompt).toContain('BTC DATA:');
      expect(prompt).not.toContain('OPEN BTC POSITIONS:');
      expect(prompt).not.toContain('PENDING BTC LIMIT ORDERS:');
    });
  });

  describe('OHLC data for Kim Nghia method', () => {
    it('should fetch OHLC candles for Kim Nghia method', async () => {
      const { getOHLCCandles } = await import('../../src/db/database.js');
      getOHLCCandles.mockResolvedValue([]);

      await buildUserPrompt(mockPriceData, mockDb, 'kim_nghia');

      expect(getOHLCCandles).toHaveBeenCalledWith(mockDb, 'BTC', 30, '15m');
    });

    it('should include OHLC data in prompt when available', async () => {
      const { getOHLCCandles, getPositions, getPendingOrders } = await import('../../src/db/database.js');
      const mockOHLC = [
        { timestamp: new Date(), open: 74900, high: 75000, low: 74800, close: 74950, volume: 1000 }
      ];
      getOHLCCandles.mockResolvedValue(mockOHLC);
      getPositions.mockResolvedValue([]);
      getPendingOrders.mockResolvedValue([]);

      const prompt = await buildUserPrompt(mockPriceData, mockDb, 'kim_nghia');

      expect(prompt).toContain('BTC OHLC CANDLES (15m, 30 candles):');
    });

    it('should not fetch OHLC for non-Kim Nghia methods', async () => {
      const { getOHLCCandles } = await import('../../src/db/database.js');
      getOHLCCandles.mockResolvedValue([]);

      await buildUserPrompt(mockPriceData, mockDb, 'ict');

      expect(getOHLCCandles).not.toHaveBeenCalled();
    });
  });
});

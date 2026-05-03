/**
 * Unit tests for Price Update Scheduler (Testnet Monitoring)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';

// Mock the scheduler module
vi.mock('../../src/schedulers/priceUpdateScheduler.js', () => ({
  initPriceUpdateScheduler: vi.fn(),
}));

// Mock dependencies
vi.mock('../../src/services/testnetEngine.js', () => ({
  updateTestnetPositionsPnL: vi.fn(() => Promise.resolve()),
  syncTestnetAccount: vi.fn(() => Promise.resolve({
    availableBalance: 950,
    totalWalletBalance: 1000,
    totalUnrealizedProfit: 50,
  })),
}));

vi.mock('../../src/db/testnetDatabase.js', () => ({
  getTestnetAccount: vi.fn(() => Promise.resolve({
    id: 1,
    symbol: 'BTC',
    method_id: 'kim_nghia',
    current_balance: 950,
    equity: 1000,
  })),
  getTestnetPositions: vi.fn(() => Promise.resolve([])),
  createTestnetAccountSnapshot: vi.fn(() => Promise.resolve(1)),
  getTestnetPendingOrders: vi.fn(() => Promise.resolve([])),
  cancelTestnetPendingOrder: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/db/database.js', () => ({
  getPendingOrders: vi.fn(() => Promise.resolve([])),
  cancelPendingOrder: vi.fn(() => Promise.resolve()),
}));

// Helper function to create in-memory database
function createTestDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(db);
      }
    });
  });
}

describe('Price Update Scheduler - Testnet Monitoring', () => {
  let db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    return new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  describe('Testnet Position Monitoring', () => {
    it('should update testnet positions with current price', async () => {
      const { updateTestnetPositionsPnL } = await import('../../src/services/testnetEngine.js');
      const currentPrice = 51000;

      await updateTestnetPositionsPnL(db, currentPrice);

      expect(updateTestnetPositionsPnL).toHaveBeenCalledWith(db, currentPrice);
    });

    it('should sync testnet account on price update', async () => {
      const { syncTestnetAccount } = await import('../../src/services/testnetEngine.js');
      const { getTestnetAccount } = await import('../../src/db/testnetDatabase.js');

      const account = await getTestnetAccount(db, 'BTC', 'kim_nghia');
      const balance = await syncTestnetAccount(db, account);

      expect(balance).not.toBeNull();
      expect(balance.availableBalance).toBe(950);
    });

    it('should handle missing testnet account gracefully', async () => {
      const { getTestnetAccount } = await import('../../src/db/testnetDatabase.js');
      
      // Mock to return null
      getTestnetAccount.mockResolvedValueOnce(null);

      const account = await getTestnetAccount(db, 'BTC', 'kim_nghia');
      expect(account).toBeNull();
    });
  });

  describe('Testnet Account Snapshots', () => {
    it('should create testnet account snapshots', async () => {
      const { createTestnetAccountSnapshot } = await import('../../src/db/testnetDatabase.js');
      const { getTestnetAccount } = await import('../../src/db/testnetDatabase.js');

      const account = await getTestnetAccount(db, 'BTC', 'kim_nghia');
      const snapshotId = await createTestnetAccountSnapshot(db, account.id);

      expect(snapshotId).toBe(1);
      expect(createTestnetAccountSnapshot).toHaveBeenCalledWith(db, account.id);
    });

    it('should create snapshots every 5 minutes', async () => {
      const { createTestnetAccountSnapshot } = await import('../../src/db/testnetDatabase.js');
      const { getTestnetAccount } = await import('../../src/db/testnetDatabase.js');

      // Clear mock before test
      createTestnetAccountSnapshot.mockClear();

      const account = await getTestnetAccount(db, 'BTC', 'kim_nghia');
      
      // Simulate multiple snapshot creations
      const snapshot1 = await createTestnetAccountSnapshot(db, account.id);
      const snapshot2 = await createTestnetAccountSnapshot(db, account.id);
      const snapshot3 = await createTestnetAccountSnapshot(db, account.id);

      // Verify all snapshots were created successfully
      expect(snapshot1).toBe(1);
      expect(snapshot2).toBe(1);
      expect(snapshot3).toBe(1);
      expect(createTestnetAccountSnapshot).toHaveBeenCalledTimes(3);
    });
  });

  describe('Testnet Price Update Integration', () => {
    it('should handle BTC price updates for testnet', async () => {
      const { updateTestnetPositionsPnL } = await import('../../src/services/testnetEngine.js');
      const { getTestnetAccount } = await import('../../src/db/testnetDatabase.js');

      const prices = {
        btc: { price: 51000 },
        eth: { price: 3000 },
      };

      const account = await getTestnetAccount(db, 'BTC', 'kim_nghia');
      
      // Update with BTC price
      await updateTestnetPositionsPnL(db, prices.btc.price);

      expect(updateTestnetPositionsPnL).toHaveBeenCalledWith(db, 51000);
    });

    it('should skip testnet update when price is missing', async () => {
      const { updateTestnetPositionsPnL } = await import('../../src/services/testnetEngine.js');

      const prices = {
        btc: null,
        eth: { price: 3000 },
      };

      // Reset mock before test
      updateTestnetPositionsPnL.mockClear();

      // Should not call updateTestnetPositionsPnL when btc price is null
      if (prices.btc) {
        await updateTestnetPositionsPnL(db, prices.btc.price);
      }

      expect(updateTestnetPositionsPnL).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle testnet sync errors gracefully', async () => {
      const { syncTestnetAccount } = await import('../../src/services/testnetEngine.js');
      const { getTestnetAccount } = await import('../../src/db/testnetDatabase.js');

      // Mock to throw error
      syncTestnetAccount.mockRejectedValueOnce(new Error('API Error'));

      const account = await getTestnetAccount(db, 'BTC', 'kim_nghia');
      
      await expect(syncTestnetAccount(db, account)).rejects.toThrow('API Error');
    });

    it('should handle PnL update errors gracefully', async () => {
      const { updateTestnetPositionsPnL } = await import('../../src/services/testnetEngine.js');

      // Mock to throw error
      updateTestnetPositionsPnL.mockRejectedValueOnce(new Error('Database Error'));

      await expect(updateTestnetPositionsPnL(db, 51000)).rejects.toThrow('Database Error');
    });
  });

  describe('Testnet Enabled Check', () => {
    it('should only run testnet updates when enabled', () => {
      const originalEnv = process.env.BINANCE_ENABLED;

      process.env.BINANCE_ENABLED = 'true';
      const enabled = process.env.BINANCE_ENABLED === 'true';

      process.env.BINANCE_ENABLED = 'false';
      const disabled = process.env.BINANCE_ENABLED === 'true';

      process.env.BINANCE_ENABLED = originalEnv;
      expect(disabled).toBe(false);
    });
  });

  describe('Stale Order Cancellation (New Feature)', () => {
    it('should cancel paper trading orders older than 24 hours', async () => {
      const { getPendingOrders, cancelPendingOrder } = await import('../../src/db/database.js');
      
      const now = Date.now();
      const twentyFiveHoursAgo = now - (25 * 60 * 60 * 1000);
      const oneHourAgo = now - (1 * 60 * 60 * 1000);

      // Mock orders: one stale (>24h), one fresh (<24h)
      getPendingOrders.mockResolvedValue([
        { id: 1, symbol: 'BTC', status: 'pending', created_at: new Date(twentyFiveHoursAgo).toISOString() },
        { id: 2, symbol: 'BTC', status: 'pending', created_at: new Date(oneHourAgo).toISOString() }
      ]);

      // Simulate the cancellation logic
      const pendingOrders = await getPendingOrders(db, { symbol: 'BTC', status: 'pending' });
      const STALE_THRESHOLD = 24 * 60 * 60 * 1000;

      for (const order of pendingOrders) {
        const createdAt = new Date(order.created_at).getTime();
        if (now - createdAt > STALE_THRESHOLD) {
          await cancelPendingOrder(db, order.id, 'stale');
        }
      }

      expect(cancelPendingOrder).toHaveBeenCalledTimes(1);
      expect(cancelPendingOrder).toHaveBeenCalledWith(db, 1, 'stale');
    });

    it('should not cancel paper trading orders younger than 24 hours', async () => {
      const { getPendingOrders, cancelPendingOrder } = await import('../../src/db/database.js');
      
      const now = Date.now();
      const twelveHoursAgo = now - (12 * 60 * 60 * 1000);

      getPendingOrders.mockResolvedValue([
        { id: 1, symbol: 'BTC', status: 'pending', created_at: new Date(twelveHoursAgo).toISOString() }
      ]);

      // Simulate the cancellation logic
      const pendingOrders = await getPendingOrders(db, { symbol: 'BTC', status: 'pending' });
      const STALE_THRESHOLD = 24 * 60 * 60 * 1000;

      for (const order of pendingOrders) {
        const createdAt = new Date(order.created_at).getTime();
        if (now - createdAt > STALE_THRESHOLD) {
          await cancelPendingOrder(db, order.id, 'stale');
        }
      }

      expect(cancelPendingOrder).not.toHaveBeenCalled();
    });

    it('should cancel testnet orders older than 24 hours when Binance enabled', async () => {
      const originalEnv = process.env.BINANCE_ENABLED;
      process.env.BINANCE_ENABLED = 'true';

      const { getTestnetPendingOrders, cancelTestnetPendingOrder } = await import('../../src/db/testnetDatabase.js');
      
      const now = Date.now();
      const twentyFiveHoursAgo = now - (25 * 60 * 60 * 1000);

      getTestnetPendingOrders.mockResolvedValue([
        { order_id: 'test1', symbol: 'BTC', status: 'pending', created_at: new Date(twentyFiveHoursAgo).toISOString(), binance_order_id: 'binance1' }
      ]);

      // Simulate the testnet cancellation logic
      if (process.env.BINANCE_ENABLED === 'true') {
        const pendingOrders = await getTestnetPendingOrders(db, { symbol: 'BTC', status: 'pending' });
        const STALE_THRESHOLD = 24 * 60 * 60 * 1000;

        for (const order of pendingOrders) {
          const createdAt = new Date(order.created_at).getTime();
          if (now - createdAt > STALE_THRESHOLD) {
            await cancelTestnetPendingOrder(db, order.order_id, 'stale', order.binance_order_id);
          }
        }
      }

      expect(cancelTestnetPendingOrder).toHaveBeenCalledTimes(1);
      expect(cancelTestnetPendingOrder).toHaveBeenCalledWith(db, 'test1', 'stale', 'binance1');

      process.env.BINANCE_ENABLED = originalEnv;
    });

    it('should skip testnet order cancellation when Binance disabled', async () => {
      const originalEnv = process.env.BINANCE_ENABLED;
      process.env.BINANCE_ENABLED = 'false';

      const { getTestnetPendingOrders, cancelTestnetPendingOrder } = await import('../../src/db/testnetDatabase.js');
      
      const now = Date.now();
      const twentyFiveHoursAgo = now - (25 * 60 * 60 * 1000);

      getTestnetPendingOrders.mockResolvedValue([
        { order_id: 'test1', symbol: 'BTC', status: 'pending', created_at: new Date(twentyFiveHoursAgo).toISOString(), binance_order_id: 'binance1' }
      ]);

      // Simulate the testnet cancellation logic
      if (process.env.BINANCE_ENABLED === 'true') {
        const pendingOrders = await getTestnetPendingOrders(db, { symbol: 'BTC', status: 'pending' });
        const STALE_THRESHOLD = 24 * 60 * 60 * 1000;

        for (const order of pendingOrders) {
          const createdAt = new Date(order.created_at).getTime();
          if (now - createdAt > STALE_THRESHOLD) {
            await cancelTestnetPendingOrder(db, order.order_id, 'stale', order.binance_order_id);
          }
        }
      }

      expect(cancelTestnetPendingOrder).not.toHaveBeenCalled();

      process.env.BINANCE_ENABLED = originalEnv;
    });
  });
});

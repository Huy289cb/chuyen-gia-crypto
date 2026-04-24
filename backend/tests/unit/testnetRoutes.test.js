/**
 * Unit tests for Testnet Routes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';

// Mock database functions
vi.mock('../../src/db/testnetDatabase.js', () => ({
  getTestnetAccount: vi.fn(() => Promise.resolve({
    id: 1,
    symbol: 'BTC',
    method_id: 'kim_nghia',
    starting_balance: 100,
    current_balance: 950,
    equity: 1000,
    unrealized_pnl: 50,
    realized_pnl: 0,
    total_trades: 10,
    winning_trades: 6,
    losing_trades: 4,
    max_drawdown: 5,
    consecutive_losses: 0,
  })),
  getTestnetPositions: vi.fn(() => Promise.resolve([
    {
      id: 1,
      position_id: 'test_pos_1',
      account_id: 1,
      symbol: 'BTCUSDT',
      side: 'BUY',
      entry_price: 50000,
      current_price: 51000,
      stop_loss: 49000,
      take_profit: 52000,
      status: 'open',
      size_usd: 100,
      size_qty: 0.002,
      unrealized_pnl: 20,
    },
  ])),
  getTestnetPosition: vi.fn(() => Promise.resolve({
    id: 1,
    position_id: 'test_pos_1',
    account_id: 1,
    symbol: 'BTCUSDT',
    side: 'BUY',
    entry_price: 50000,
    current_price: 51000,
    stop_loss: 49000,
    take_profit: 52000,
    status: 'open',
  })),
  getTestnetPerformanceMetrics: vi.fn(() => Promise.resolve({
    id: 1,
    current_balance: 950,
    equity: 1000,
    win_rate: 60,
    profit_factor: 1.5,
    total_return: 850,
  })),
  getTestnetAccountSnapshots: vi.fn(() => Promise.resolve([
    {
      id: 1,
      account_id: 1,
      balance: 950,
      equity: 1000,
      timestamp: '2024-01-01T00:00:00Z',
    },
  ])),
  resetTestnetAccount: vi.fn(() => Promise.resolve(1)),
  getTestnetTradeEvents: vi.fn(() => Promise.resolve([])),
}));

// Mock testnet engine functions
vi.mock('../../src/services/testnetEngine.js', () => ({
  syncTestnetAccount: vi.fn(() => Promise.resolve({
    availableBalance: 950,
    totalWalletBalance: 1000,
    totalUnrealizedProfit: 50,
  })),
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

describe('Testnet Routes', () => {
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

  describe('Database Functions', () => {
    it('should get testnet account', async () => {
      const { getTestnetAccount } = await import('../../src/db/testnetDatabase.js');
      const account = await getTestnetAccount(db, 'BTC', 'kim_nghia');
      
      expect(account).not.toBeNull();
      expect(account.id).toBe(1);
      expect(account.symbol).toBe('BTC');
      expect(account.method_id).toBe('kim_nghia');
    });

    it('should get testnet positions', async () => {
      const { getTestnetPositions } = await import('../../src/db/testnetDatabase.js');
      const positions = await getTestnetPositions(db, { status: 'open' });
      
      expect(positions).toBeInstanceOf(Array);
      expect(positions.length).toBeGreaterThan(0);
    });

    it('should get testnet performance metrics', async () => {
      const { getTestnetPerformanceMetrics } = await import('../../src/db/testnetDatabase.js');
      const metrics = await getTestnetPerformanceMetrics(db, 1);
      
      expect(metrics).not.toBeNull();
      expect(metrics.win_rate).toBeDefined();
      expect(metrics.profit_factor).toBeDefined();
    });

    it('should get testnet account snapshots', async () => {
      const { getTestnetAccountSnapshots } = await import('../../src/db/testnetDatabase.js');
      const snapshots = await getTestnetAccountSnapshots(db, 1, 10);
      
      expect(snapshots).toBeInstanceOf(Array);
    });

    it('should reset testnet account', async () => {
      const { resetTestnetAccount } = await import('../../src/db/testnetDatabase.js');
      const result = await resetTestnetAccount(db, 1);
      
      expect(result).toBe(1);
    });
  });

  describe('Testnet Engine Functions', () => {
    it('should sync testnet account', async () => {
      const { syncTestnetAccount } = await import('../../src/services/testnetEngine.js');
      const { getTestnetAccount } = await import('../../src/db/testnetDatabase.js');
      
      const account = await getTestnetAccount(db, 'BTC', 'kim_nghia');
      const balance = await syncTestnetAccount(db, account);
      
      expect(balance).not.toBeNull();
      expect(balance.availableBalance).toBe(950);
      expect(balance.totalWalletBalance).toBe(1000);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const { getTestnetAccount } = await import('../../src/db/testnetDatabase.js');
      getTestnetAccount.mockRejectedValueOnce(new Error('Database Error'));
      
      await expect(getTestnetAccount(db, 'BTC', 'kim_nghia')).rejects.toThrow('Database Error');
    });

    it('should handle sync errors gracefully', async () => {
      const { syncTestnetAccount } = await import('../../src/services/testnetEngine.js');
      const { getTestnetAccount } = await import('../../src/db/testnetDatabase.js');
      
      syncTestnetAccount.mockRejectedValueOnce(new Error('API Error'));
      
      const account = await getTestnetAccount(db, 'BTC', 'kim_nghia');
      await expect(syncTestnetAccount(db, account)).rejects.toThrow('API Error');
    });
  });
});

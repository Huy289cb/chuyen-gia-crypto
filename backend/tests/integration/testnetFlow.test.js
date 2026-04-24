/**
 * Integration tests for Testnet Trading Flow
 * 
 * Tests the complete flow from analysis → auto-entry → Binance order → database save
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';

// Mock binance client
vi.mock('../../src/services/binanceClient.js', () => ({
  initTestnetClient: vi.fn(() => ({ mockClient: true })),
  testConnection: vi.fn(() => Promise.resolve({ success: true, serverTime: 1234567890 })),
  getAccountBalance: vi.fn(() => Promise.resolve({
    walletBalance: 1000,
    availableBalance: 950,
    totalWalletBalance: 1000,
    totalUnrealizedProfit: 50,
  })),
  placeMarketOrder: vi.fn(() => Promise.resolve({
    orderId: 12345,
    clientOrderId: 'client123',
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    transactTime: 1234567890,
    executedQty: 0.01,
    cummulativeQuoteQty: 500,
    status: 'FILLED',
  })),
  placeStopLossOrder: vi.fn(() => Promise.resolve({
    orderId: 12346,
    clientOrderId: 'client124',
    symbol: 'BTCUSDT',
    side: 'SELL',
    type: 'STOP_MARKET',
    stopPrice: 49000,
    transactTime: 1234567890,
    status: 'NEW',
  })),
  placeTakeProfitOrder: vi.fn(() => Promise.resolve({
    orderId: 12347,
    clientOrderId: 'client125',
    symbol: 'BTCUSDT',
    side: 'SELL',
    type: 'TAKE_PROFIT_MARKET',
    stopPrice: 52000,
    transactTime: 1234567890,
    status: 'NEW',
  })),
  cancelOrder: vi.fn(() => Promise.resolve({
    orderId: 12346,
    symbol: 'BTCUSDT',
    status: 'CANCELED',
  })),
  setLeverage: vi.fn(() => Promise.resolve({
    symbol: 'BTCUSDT',
    leverage: 1,
    maxNotionalValue: 1000000,
  })),
  setMarginType: vi.fn(() => Promise.resolve({ symbol: 'BTCUSDT', marginType: 'ISOLATED' })),
  getOpenOrders: vi.fn(() => Promise.resolve([
    {
      orderId: 12346,
      clientOrderId: 'client124',
      symbol: 'BTCUSDT',
      side: 'SELL',
      type: 'STOP_MARKET',
      stopPrice: 49000,
      status: 'NEW',
    },
    {
      orderId: 12347,
      clientOrderId: 'client125',
      symbol: 'BTCUSDT',
      side: 'SELL',
      type: 'TAKE_PROFIT_MARKET',
      stopPrice: 52000,
      status: 'NEW',
    },
  ])),
}));

// Mock binance config
vi.mock('../../src/config/binance.js', () => ({
  binanceConfig: {
    enabled: true,
    apiKey: 'test_key',
    secretKey: 'test_secret',
    symbol: 'BTCUSDT',
    leverage: 1,
  },
  getLeverage: () => 1,
  getSymbol: () => 'BTCUSDT',
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

// Helper function to run migrations
async function runTestMigrations(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS testnet_accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          method_id TEXT NOT NULL,
          starting_balance REAL NOT NULL,
          current_balance REAL NOT NULL,
          equity REAL NOT NULL,
          unrealized_pnl REAL DEFAULT 0,
          realized_pnl REAL DEFAULT 0,
          total_trades INTEGER DEFAULT 0,
          winning_trades INTEGER DEFAULT 0,
          losing_trades INTEGER DEFAULT 0,
          max_drawdown REAL DEFAULT 0,
          consecutive_losses INTEGER DEFAULT 0,
          last_trade_time DATETIME,
          cooldown_until DATETIME,
          api_key_hash TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(symbol, method_id)
        )
      `, (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        db.run(`
          CREATE TABLE IF NOT EXISTS testnet_positions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            position_id TEXT UNIQUE NOT NULL,
            account_id INTEGER NOT NULL,
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            entry_price REAL NOT NULL,
            current_price REAL DEFAULT 0,
            stop_loss REAL NOT NULL,
            take_profit REAL NOT NULL,
            entry_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            status TEXT NOT NULL DEFAULT 'open',
            size_usd REAL NOT NULL,
            size_qty REAL NOT NULL,
            risk_usd REAL NOT NULL,
            risk_percent REAL NOT NULL,
            expected_rr REAL NOT NULL,
            realized_pnl REAL DEFAULT 0,
            unrealized_pnl REAL DEFAULT 0,
            close_price REAL,
            close_time DATETIME,
            close_reason TEXT,
            linked_prediction_id INTEGER,
            binance_order_id TEXT,
            binance_sl_order_id TEXT,
            binance_tp_order_id TEXT,
            FOREIGN KEY (account_id) REFERENCES testnet_accounts(id)
          )
        `, (err) => {
          if (err) {
            reject(err);
            return;
          }
          
          db.run(`
            CREATE TABLE IF NOT EXISTS testnet_trade_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              position_id TEXT NOT NULL,
              event_type TEXT NOT NULL,
              event_data TEXT,
              timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          `, (err) => {
            if (err) {
              reject(err);
              return;
            }
            
            db.run(`
              CREATE TABLE IF NOT EXISTS testnet_account_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                balance REAL NOT NULL,
                equity REAL NOT NULL,
                unrealized_pnl REAL DEFAULT 0,
                realized_pnl REAL DEFAULT 0,
                open_positions_count INTEGER DEFAULT 0,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (account_id) REFERENCES testnet_accounts(id)
              )
            `, (err) => {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          });
        });
      });
    });
  });
}

describe('Testnet Flow Integration', () => {
  let db;

  beforeEach(async () => {
    db = await createTestDb();
    await runTestMigrations(db);
  });

  afterEach(async () => {
    return new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  describe('Full flow: analysis → auto-entry → Binance order → database save', () => {
    it('should complete full position opening flow', async () => {
      const { initTestnetEngine } = await import('../../src/services/testnetEngine.js');
      const { getOrCreateTestnetAccount } = await import('../../src/db/testnetDatabase.js');
      const { openTestnetPosition } = await import('../../src/services/testnetEngine.js');

      // Initialize testnet engine
      await initTestnetEngine();

      // Get or create testnet account
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      expect(account).not.toBeNull();
      expect(account.symbol).toBe('BTC');
      expect(account.method_id).toBe('kim_nghia');
      expect(account.current_balance).toBe(100);

      // Simulate analysis result
      const positionData = {
        side: 'BUY',
        entry_price: 50000,
        stop_loss: 49000,
        take_profit: 52000,
        size_usd: 100,
        risk_usd: 10,
        risk_percent: 10,
        expected_rr: 2.0,
      };

      // Open testnet position
      const position = await openTestnetPosition(db, account, positionData, 1, 'kim_nghia');
      
      expect(position).not.toBeNull();
      expect(position.side).toBe('BUY');
      expect(position.entry_price).toBe(50000);
      expect(position.status).toBe('open');
      expect(position.binance_order_id).toBe('12345');
      expect(position.binance_sl_order_id).toBe('12346');
      expect(position.binance_tp_order_id).toBe('12347');

      // Verify position was saved to database
      const savedPosition = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM testnet_positions WHERE position_id = ?', [position.position_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      expect(savedPosition).not.toBeNull();
      expect(savedPosition.side).toBe('BUY');
      expect(savedPosition.entry_price).toBe(50000);

      // Verify trade event was recorded
      const events = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM testnet_trade_events WHERE position_id = ?', [position.position_id], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('position_opened');
    });
  });

  describe('SL/TP execution flow', () => {
    it('should execute SL and close position', async () => {
      const { initTestnetEngine } = await import('../../src/services/testnetEngine.js');
      const { getOrCreateTestnetAccount, createTestnetPosition, getTestnetPosition } = await import('../../src/db/testnetDatabase.js');
      const { checkTestnetSLTP } = await import('../../src/services/testnetEngine.js');

      await initTestnetEngine();
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');

      await createTestnetPosition(db, {
        position_id: 'test_pos_sl',
        account_id: account.id,
        symbol: 'BTCUSDT',
        side: 'BUY',
        entry_price: 50000,
        stop_loss: 49000,
        take_profit: 52000,
        size_usd: 100,
        size_qty: 0.002,
        risk_usd: 10,
        risk_percent: 10,
        expected_rr: 2.0,
        binance_order_id: '12345',
        binance_sl_order_id: '12346',
        binance_tp_order_id: '12347',
      });

      const position = await getTestnetPosition(db, 'test_pos_sl');
      const result = await checkTestnetSLTP(db, position, 48500);

      expect(result).toBe('stop_loss');

      const closedPosition = await getTestnetPosition(db, 'test_pos_sl');
      expect(closedPosition.status).toBe('closed');
      expect(closedPosition.close_price).toBe(48500);
      expect(closedPosition.close_reason).toBe('stop_loss');
    });

    it('should execute TP and close position', async () => {
      const { initTestnetEngine } = await import('../../src/services/testnetEngine.js');
      const { getOrCreateTestnetAccount, createTestnetPosition, getTestnetPosition } = await import('../../src/db/testnetDatabase.js');
      const { checkTestnetSLTP } = await import('../../src/services/testnetEngine.js');

      await initTestnetEngine();
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');

      await createTestnetPosition(db, {
        position_id: 'test_pos_tp',
        account_id: account.id,
        symbol: 'BTCUSDT',
        side: 'BUY',
        entry_price: 50000,
        stop_loss: 49000,
        take_profit: 52000,
        size_usd: 100,
        size_qty: 0.002,
        risk_usd: 10,
        risk_percent: 10,
        expected_rr: 2.0,
        binance_order_id: '12345',
        binance_sl_order_id: '12346',
        binance_tp_order_id: '12347',
      });

      const position = await getTestnetPosition(db, 'test_pos_tp');
      const result = await checkTestnetSLTP(db, position, 52500);

      expect(result).toBe('take_profit');

      const closedPosition = await getTestnetPosition(db, 'test_pos_tp');
      expect(closedPosition.status).toBe('closed');
      expect(closedPosition.close_price).toBe(52500);
      expect(closedPosition.close_reason).toBe('take_profit');
    });
  });

  describe('Position decisions flow', () => {
    it('should handle AI position decision to close early', async () => {
      const { initTestnetEngine } = await import('../../src/services/testnetEngine.js');
      const { getOrCreateTestnetAccount, createTestnetPosition, getTestnetPosition } = await import('../../src/db/testnetDatabase.js');
      const { closeTestnetPositionEngine } = await import('../../src/services/testnetEngine.js');

      await initTestnetEngine();
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');

      await createTestnetPosition(db, {
        position_id: 'test_pos_decision',
        account_id: account.id,
        symbol: 'BTCUSDT',
        side: 'BUY',
        entry_price: 50000,
        stop_loss: 49000,
        take_profit: 52000,
        size_usd: 100,
        size_qty: 0.002,
        risk_usd: 10,
        risk_percent: 10,
        expected_rr: 2.0,
        binance_order_id: '12345',
        binance_sl_order_id: '12346',
        binance_tp_order_id: '12347',
      });

      const position = await getTestnetPosition(db, 'test_pos_decision');
      const result = await closeTestnetPositionEngine(db, position, 50500, 'ai_close_early');

      expect(result).not.toBeNull();
      expect(result.realizedPnl).toBe(10); // (50500 - 50000) * 0.002 = 10
      expect(result.isWin).toBe(true);

      const closedPosition = await getTestnetPosition(db, 'test_pos_decision');
      expect(closedPosition.status).toBe('closed');
      expect(closedPosition.close_reason).toBe('ai_close_early');
    });

    it('should handle AI position decision to update SL', async () => {
      const { initTestnetEngine } = await import('../../src/services/testnetEngine.js');
      const { getOrCreateTestnetAccount, createTestnetPosition, getTestnetPosition } = await import('../../src/db/testnetDatabase.js');
      const { updateTestnetPositionSL } = await import('../../src/services/testnetEngine.js');

      await initTestnetEngine();
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');

      await createTestnetPosition(db, {
        position_id: 'test_pos_sl_update',
        account_id: account.id,
        symbol: 'BTCUSDT',
        side: 'BUY',
        entry_price: 50000,
        stop_loss: 49000,
        take_profit: 52000,
        size_usd: 100,
        size_qty: 0.002,
        risk_usd: 10,
        risk_percent: 10,
        expected_rr: 2.0,
        binance_sl_order_id: '12346',
      });

      const position = await getTestnetPosition(db, 'test_pos_sl_update');
      await updateTestnetPositionSL(db, position, 49500, 'breakeven');

      const updated = await getTestnetPosition(db, 'test_pos_sl_update');
      expect(updated.stop_loss).toBe(49500);
    });
  });

  describe('Account sync flow', () => {
    it('should sync account balance from Binance and detect discrepancies', async () => {
      const { initTestnetEngine } = await import('../../src/services/testnetEngine.js');
      const { getOrCreateTestnetAccount } = await import('../../src/db/testnetDatabase.js');
      const { syncTestnetAccount } = await import('../../src/services/testnetEngine.js');

      await initTestnetEngine();
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');

      // Manually set a different balance in database
      await new Promise((resolve, reject) => {
        db.run('UPDATE testnet_accounts SET current_balance = 900, equity = 900 WHERE id = ?', [account.id], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const balance = await syncTestnetAccount(db, account);

      expect(balance).not.toBeNull();
      expect(balance.availableBalance).toBe(950);

      // Verify database was auto-corrected
      const updatedAccount = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM testnet_accounts WHERE id = ?', [account.id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      expect(updatedAccount.current_balance).toBe(950);
    });

    it('should create account snapshot on sync', async () => {
      const { initTestnetEngine } = await import('../../src/services/testnetEngine.js');
      const { getOrCreateTestnetAccount } = await import('../../src/db/testnetDatabase.js');
      const { syncTestnetAccount } = await import('../../src/services/testnetEngine.js');

      await initTestnetEngine();
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');

      await syncTestnetAccount(db, account);

      // Verify snapshot was created
      const snapshots = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM testnet_account_snapshots WHERE account_id = ?', [account.id], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      expect(snapshots.length).toBeGreaterThan(0);
      expect(snapshots[0].account_id).toBe(account.id);
    });
  });

  describe('Error handling and fallback', () => {
    it('should handle Binance API failure gracefully', async () => {
      const { initTestnetEngine } = await import('../../src/services/testnetEngine.js');
      const { getOrCreateTestnetAccount } = await import('../../src/db/testnetDatabase.js');
      const { openTestnetPosition } = await import('../../src/services/testnetEngine.js');

      // Mock API failure
      const { placeMarketOrder } = await import('../../src/services/binanceClient.js');
      vi.mocked(placeMarketOrder).mockRejectedValueOnce(new Error('API Error'));

      await initTestnetEngine();
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');

      const positionData = {
        side: 'BUY',
        entry_price: 50000,
        stop_loss: 49000,
        take_profit: 52000,
        size_usd: 100,
        risk_usd: 10,
        risk_percent: 10,
        expected_rr: 2.0,
      };

      await expect(openTestnetPosition(db, account, positionData, 1, 'kim_nghia')).rejects.toThrow();

      // Verify failure event was recorded
      const events = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM testnet_trade_events WHERE event_type = ?', ['position_open_failed'], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      expect(events.length).toBeGreaterThan(0);
    });

    it('should handle position size validation', async () => {
      const { initTestnetEngine } = await import('../../src/services/testnetEngine.js');
      const { getOrCreateTestnetAccount } = await import('../../src/db/testnetDatabase.js');
      const { openTestnetPosition } = await import('../../src/services/testnetEngine.js');

      await initTestnetEngine();
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');

      const positionData = {
        side: 'BUY',
        entry_price: 50000,
        stop_loss: 49000,
        take_profit: 52000,
        size_usd: 200, // Exceeds 100 balance
        risk_usd: 10,
        risk_percent: 10,
        expected_rr: 2.0,
      };

      await expect(openTestnetPosition(db, account, positionData, 1, 'kim_nghia')).rejects.toThrow('Position size exceeds account balance');
    });
  });
});

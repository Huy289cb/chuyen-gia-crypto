/**
 * Unit tests for Testnet Trading Engine
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import {
  initTestnetEngine,
  openTestnetPosition,
  closeTestnetPositionEngine,
  updateTestnetPositionSL,
  checkTestnetSLTP,
  syncTestnetAccount,
  updateTestnetPositionsPnL,
  getTestnetClient,
} from '../../src/services/testnetEngine.js';
import {
  getOrCreateTestnetAccount,
  createTestnetPosition,
  getTestnetPosition,
} from '../../src/db/testnetDatabase.js';

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
  getCurrentPosition: vi.fn(() => Promise.resolve(null)),
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

describe('Testnet Engine', () => {
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

  describe('initTestnetEngine', () => {
    it('should initialize testnet client', async () => {
      const client = await initTestnetEngine();
      expect(client).not.toBeNull();
      expect(client.mockClient).toBe(true);
    });
  });

  describe('openTestnetPosition', () => {
    it('should open testnet position successfully', async () => {
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
      
      const position = await openTestnetPosition(db, account, positionData, 1, 'kim_nghia');
      
      expect(position).not.toBeNull();
      expect(position.side).toBe('BUY');
      expect(position.entry_price).toBe(50000);
      expect(position.status).toBe('open');
      expect(position.binance_order_id).toBe('12345');
    });

    it('should throw error when position size exceeds balance', async () => {
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

    it('should skip when account is in cooldown', async () => {
      await initTestnetEngine();
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      
      // Set cooldown to future
      const futureTime = new Date(Date.now() + 3600000).toISOString();
      db.run('UPDATE testnet_accounts SET cooldown_until = ? WHERE id = ?', [futureTime, account.id]);
      
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
      
      const result = await openTestnetPosition(db, account, positionData, 1, 'kim_nghia');
      expect(result).toBeNull();
    });
  });

  describe('closeTestnetPositionEngine', () => {
    it('should close position and calculate PnL', async () => {
      await initTestnetEngine();
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      
      await createTestnetPosition(db, {
        position_id: 'test_pos_1',
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
      
      const position = await getTestnetPosition(db, 'test_pos_1');
      const result = await closeTestnetPositionEngine(db, position, 51000, 'manual');
      
      expect(result).not.toBeNull();
      expect(result.realizedPnl).toBe(20); // (51000 - 50000) * 0.002
      expect(result.isWin).toBe(true);
      
      const closedPosition = await getTestnetPosition(db, 'test_pos_1');
      expect(closedPosition.status).toBe('closed');
      expect(closedPosition.close_price).toBe(51000);
    });
  });

  describe('updateTestnetPositionSL', () => {
    it('should update stop loss', async () => {
      await initTestnetEngine();
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      
      await createTestnetPosition(db, {
        position_id: 'test_pos_1',
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
      
      const position = await getTestnetPosition(db, 'test_pos_1');
      await updateTestnetPositionSL(db, position, 49500, 'breakeven');
      
      const updated = await getTestnetPosition(db, 'test_pos_1');
      expect(updated.stop_loss).toBe(49500);
    });
  });

  describe('checkTestnetSLTP', () => {
    it('should detect SL hit for long position', async () => {
      await initTestnetEngine();
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      
      await createTestnetPosition(db, {
        position_id: 'test_pos_1',
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
      
      const position = await getTestnetPosition(db, 'test_pos_1');
      const result = await checkTestnetSLTP(db, position, 48500);
      
      expect(result).toBe('stop_loss');
      
      const closed = await getTestnetPosition(db, 'test_pos_1');
      expect(closed.status).toBe('closed');
    });

    it('should detect TP hit for long position', async () => {
      await initTestnetEngine();
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      
      await createTestnetPosition(db, {
        position_id: 'test_pos_1',
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
      
      const position = await getTestnetPosition(db, 'test_pos_1');
      const result = await checkTestnetSLTP(db, position, 52500);
      
      expect(result).toBe('take_profit');
      
      const closed = await getTestnetPosition(db, 'test_pos_1');
      expect(closed.status).toBe('closed');
    });

    it('should return null when SL/TP not hit', async () => {
      await initTestnetEngine();
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      
      await createTestnetPosition(db, {
        position_id: 'test_pos_1',
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
      });
      
      const position = await getTestnetPosition(db, 'test_pos_1');
      const result = await checkTestnetSLTP(db, position, 50500);
      
      expect(result).toBeNull();
      
      const stillOpen = await getTestnetPosition(db, 'test_pos_1');
      expect(stillOpen.status).toBe('open');
    });
  });

  describe('syncTestnetAccount', () => {
    it('should sync account balance from Binance', async () => {
      await initTestnetEngine();
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      
      const balance = await syncTestnetAccount(db, account);
      
      expect(balance).not.toBeNull();
      expect(balance.availableBalance).toBe(950);
      expect(balance.totalWalletBalance).toBe(1000);
    });
  });

  describe('updateTestnetPositionsPnL', () => {
    it('should update unrealized PnL for open positions', async () => {
      await initTestnetEngine();
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      
      await createTestnetPosition(db, {
        position_id: 'test_pos_1',
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
      });
      
      await updateTestnetPositionsPnL(db, 51000);
      
      const position = await getTestnetPosition(db, 'test_pos_1');
      expect(position.current_price).toBe(51000);
      expect(position.unrealized_pnl).toBe(20);
    });
  });

  describe('getTestnetClient', () => {
    it('should return client instance', async () => {
      await initTestnetEngine();
      const client = getTestnetClient();
      expect(client).not.toBeNull();
      expect(client.mockClient).toBe(true);
    });
  });
});

/**
 * Unit tests for Testnet Database Functions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import {
  getOrCreateTestnetAccount,
  getTestnetAccount,
  updateTestnetAccountBalance,
  updateTestnetAccountEquity,
  updateTestnetAccountStats,
  createTestnetPosition,
  getTestnetPositions,
  getTestnetPosition,
  updateTestnetPosition,
  closeTestnetPosition,
  recordTestnetTradeEvent,
  createTestnetAccountSnapshot,
  getTestnetAccountSnapshots,
  getTestnetPerformanceMetrics,
  getTestnetTradeEvents,
  resetTestnetAccount,
} from '../../src/db/testnetDatabase.js';

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

describe('Testnet Database', () => {
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

  describe('getOrCreateTestnetAccount', () => {
    it('should create new account with 100U starting balance', async () => {
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      expect(account).not.toBeNull();
      expect(account.symbol).toBe('BTC');
      expect(account.method_id).toBe('kim_nghia');
      expect(account.starting_balance).toBe(100);
      expect(account.current_balance).toBe(100);
      expect(account.equity).toBe(100);
    });

    it('should return existing account if already exists', async () => {
      const account1 = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      const account2 = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      expect(account1.id).toBe(account2.id);
      expect(account1.symbol).toBe(account2.symbol);
    });

    it('should create separate accounts for different methods', async () => {
      const account1 = await getOrCreateTestnetAccount(db, 'BTC', 'ict');
      const account2 = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      expect(account1.id).not.toBe(account2.id);
      expect(account1.method_id).toBe('ict');
      expect(account2.method_id).toBe('kim_nghia');
    });
  });

  describe('getTestnetAccount', () => {
    it('should return null for non-existent account', async () => {
      const account = await getTestnetAccount(db, 'BTC', 'kim_nghia');
      expect(account).toBeNull();
    });

    it('should return existing account', async () => {
      await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      const account = await getTestnetAccount(db, 'BTC', 'kim_nghia');
      expect(account).not.toBeNull();
      expect(account.symbol).toBe('BTC');
    });
  });

  describe('updateTestnetAccountBalance', () => {
    it('should update account balance and realized PnL', async () => {
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      await updateTestnetAccountBalance(db, account.id, 110, 10);
      
      const updated = await getTestnetAccount(db, 'BTC', 'kim_nghia');
      expect(updated.current_balance).toBe(110);
      expect(updated.realized_pnl).toBe(10);
    });
  });

  describe('updateTestnetAccountEquity', () => {
    it('should update equity and unrealized PnL', async () => {
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      await updateTestnetAccountEquity(db, account.id, 15);
      
      const updated = await getTestnetAccount(db, 'BTC', 'kim_nghia');
      expect(updated.unrealized_pnl).toBe(15);
      expect(updated.equity).toBe(115); // 100 + 15
    });
  });

  describe('updateTestnetAccountStats', () => {
    it('should increment total trades and winning trades', async () => {
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      await updateTestnetAccountStats(db, account.id, true);
      
      const updated = await getTestnetAccount(db, 'BTC', 'kim_nghia');
      expect(updated.total_trades).toBe(1);
      expect(updated.winning_trades).toBe(1);
      expect(updated.losing_trades).toBe(0);
      expect(updated.consecutive_losses).toBe(0);
    });

    it('should increment total trades and losing trades', async () => {
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      await updateTestnetAccountStats(db, account.id, false);
      
      const updated = await getTestnetAccount(db, 'BTC', 'kim_nghia');
      expect(updated.total_trades).toBe(1);
      expect(updated.winning_trades).toBe(0);
      expect(updated.losing_trades).toBe(1);
      expect(updated.consecutive_losses).toBe(1);
    });
  });

  describe('createTestnetPosition', () => {
    it('should create new position', async () => {
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      const position = await createTestnetPosition(db, {
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
        linked_prediction_id: 1,
        binance_order_id: 'order_123',
        binance_sl_order_id: 'sl_123',
        binance_tp_order_id: 'tp_123',
      });
      
      expect(position).not.toBeNull();
      expect(position.position_id).toBe('test_pos_1');
      expect(position.side).toBe('BUY');
      expect(position.entry_price).toBe(50000);
      expect(position.status).toBe('open');
    });
  });

  describe('getTestnetPositions', () => {
    it('should return empty array when no positions exist', async () => {
      const positions = await getTestnetPositions(db);
      expect(positions).toEqual([]);
    });

    it('should return all positions', async () => {
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
      
      const positions = await getTestnetPositions(db);
      expect(positions).toHaveLength(1);
    });

    it('should filter by account_id', async () => {
      const account1 = await getOrCreateTestnetAccount(db, 'BTC', 'ict');
      const account2 = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      
      await createTestnetPosition(db, {
        position_id: 'test_pos_1',
        account_id: account1.id,
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
      
      await createTestnetPosition(db, {
        position_id: 'test_pos_2',
        account_id: account2.id,
        symbol: 'BTCUSDT',
        side: 'SELL',
        entry_price: 50000,
        stop_loss: 51000,
        take_profit: 48000,
        size_usd: 100,
        size_qty: 0.002,
        risk_usd: 10,
        risk_percent: 10,
        expected_rr: 2.0,
      });
      
      const positions = await getTestnetPositions(db, { account_id: account1.id });
      expect(positions).toHaveLength(1);
      expect(positions[0].position_id).toBe('test_pos_1');
    });

    it('should filter by status', async () => {
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
      
      await closeTestnetPosition(db, 'test_pos_1', 51000, 'manual');
      
      const openPositions = await getTestnetPositions(db, { status: 'open' });
      const closedPositions = await getTestnetPositions(db, { status: 'closed' });
      
      expect(openPositions).toHaveLength(0);
      expect(closedPositions).toHaveLength(1);
    });
  });

  describe('getTestnetPosition', () => {
    it('should return null for non-existent position', async () => {
      const position = await getTestnetPosition(db, 'non_existent');
      expect(position).toBeNull();
    });

    it('should return position by ID', async () => {
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
      expect(position).not.toBeNull();
      expect(position.position_id).toBe('test_pos_1');
    });
  });

  describe('updateTestnetPosition', () => {
    it('should update position fields', async () => {
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
      
      await updateTestnetPosition(db, 'test_pos_1', {
        current_price: 51000,
        unrealized_pnl: 20,
      });
      
      const position = await getTestnetPosition(db, 'test_pos_1');
      expect(position.current_price).toBe(51000);
      expect(position.unrealized_pnl).toBe(20);
    });
  });

  describe('closeTestnetPosition', () => {
    it('should close position with price and reason', async () => {
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
      
      await closeTestnetPosition(db, 'test_pos_1', 51000, 'take_profit');
      
      const position = await getTestnetPosition(db, 'test_pos_1');
      expect(position.status).toBe('closed');
      expect(position.close_price).toBe(51000);
      expect(position.close_reason).toBe('take_profit');
      expect(position.close_time).not.toBeNull();
    });
  });

  describe('recordTestnetTradeEvent', () => {
    it('should record trade event', async () => {
      const eventId = await recordTestnetTradeEvent(db, 'test_pos_1', 'position_opened', { test: 'data' });
      expect(eventId).not.toBeNull();
      
      const events = await getTestnetTradeEvents(db, 'test_pos_1');
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('position_opened');
      expect(events[0].event_data).toEqual({ test: 'data' });
    });

    it('should record event without data', async () => {
      const eventId = await recordTestnetTradeEvent(db, 'test_pos_1', 'position_opened');
      expect(eventId).not.toBeNull();
      
      const events = await getTestnetTradeEvents(db, 'test_pos_1');
      expect(events).toHaveLength(1);
      expect(events[0].event_data).toBeNull();
    });
  });

  describe('createTestnetAccountSnapshot', () => {
    it('should create account snapshot', async () => {
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      const snapshotId = await createTestnetAccountSnapshot(db, account.id);
      expect(snapshotId).not.toBeNull();
      
      const snapshots = await getTestnetAccountSnapshots(db, account.id);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].balance).toBe(100);
      expect(snapshots[0].equity).toBe(100);
    });
  });

  describe('getTestnetPerformanceMetrics', () => {
    it('should calculate performance metrics', async () => {
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      await updateTestnetAccountBalance(db, account.id, 110, 10);
      await updateTestnetAccountStats(db, account.id, true);
      await updateTestnetAccountStats(db, account.id, true);
      await updateTestnetAccountStats(db, account.id, false);
      
      const metrics = await getTestnetPerformanceMetrics(db, account.id);
      expect(metrics).not.toBeNull();
      expect(metrics.total_trades).toBe(3);
      expect(metrics.winning_trades).toBe(2);
      expect(metrics.losing_trades).toBe(1);
      expect(metrics.win_rate).toBeCloseTo(66.67, 1);
      expect(metrics.total_return).toBe(10);
    });
  });

  describe('resetTestnetAccount', () => {
    it('should reset account to starting balance', async () => {
      const account = await getOrCreateTestnetAccount(db, 'BTC', 'kim_nghia');
      await updateTestnetAccountBalance(db, account.id, 150, 50);
      await updateTestnetAccountStats(db, account.id, true);
      
      await resetTestnetAccount(db, account.id);
      
      const reset = await getTestnetAccount(db, 'BTC', 'kim_nghia');
      expect(reset.current_balance).toBe(100);
      expect(reset.equity).toBe(100);
      expect(reset.realized_pnl).toBe(0);
      expect(reset.total_trades).toBe(0);
      expect(reset.winning_trades).toBe(0);
      expect(reset.losing_trades).toBe(0);
      expect(reset.consecutive_losses).toBe(0);
    });
  });
});

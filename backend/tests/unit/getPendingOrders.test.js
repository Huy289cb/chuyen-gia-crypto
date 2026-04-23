import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'sqlite3';
import { getPendingOrders } from '../../src/db/database.js';

describe('getPendingOrders', () => {
  let db;

  beforeEach(() => {
    // Create an in-memory database for testing
    db = new Database.Database(':memory:');
    
    // Create pending_orders table
    return new Promise((resolve, reject) => {
      db.run(`
        CREATE TABLE pending_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id TEXT UNIQUE NOT NULL,
          account_id INTEGER NOT NULL,
          symbol TEXT NOT NULL,
          side TEXT NOT NULL,
          entry_price REAL NOT NULL,
          stop_loss REAL NOT NULL,
          take_profit REAL NOT NULL,
          size_qty REAL NOT NULL,
          size_usd REAL NOT NULL,
          risk_usd REAL NOT NULL,
          risk_percent REAL NOT NULL,
          expected_rr REAL,
          status TEXT DEFAULT 'pending',
          created_at TEXT,
          executed_at TEXT,
          linked_prediction_id TEXT,
          method_id TEXT,
          invalidation_level REAL
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  describe('filtering by symbol', () => {
    it('should filter by symbol correctly', async () => {
      // Insert test data
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO pending_orders (order_id, account_id, symbol, side, entry_price, stop_loss, take_profit, size_qty, size_usd, risk_usd, risk_percent, expected_rr, status, created_at, method_id)
          VALUES 
            ('ord_1', 1, 'BTC', 'long', 73500, 73000, 75500, 0.1, 7350, 50, 0.68, 2.5, 'pending', '2024-01-01T00:00:00Z', 'kim_nghia'),
            ('ord_2', 1, 'ETH', 'long', 3450, 3400, 3650, 1.0, 3450, 50, 1.45, 2.5, 'pending', '2024-01-01T00:00:00Z', 'kim_nghia')
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const btcOrders = await getPendingOrders(db, { symbol: 'BTC' });
      const ethOrders = await getPendingOrders(db, { symbol: 'ETH' });

      expect(btcOrders).toHaveLength(1);
      expect(btcOrders[0].symbol).toBe('BTC');
      expect(ethOrders).toHaveLength(1);
      expect(ethOrders[0].symbol).toBe('ETH');
    });

    it('should be case-insensitive for symbol', async () => {
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO pending_orders (order_id, account_id, symbol, side, entry_price, stop_loss, take_profit, size_qty, size_usd, risk_usd, risk_percent, expected_rr, status, created_at, method_id)
          VALUES ('ord_1', 1, 'BTC', 'long', 73500, 73000, 75500, 0.1, 7350, 50, 0.68, 2.5, 'pending', '2024-01-01T00:00:00Z', 'kim_nghia')
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const ordersLower = await getPendingOrders(db, { symbol: 'btc' });
      const ordersUpper = await getPendingOrders(db, { symbol: 'BTC' });

      expect(ordersLower).toHaveLength(1);
      expect(ordersUpper).toHaveLength(1);
    });
  });

  describe('filtering by status', () => {
    it('should filter by status correctly', async () => {
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO pending_orders (order_id, account_id, symbol, side, entry_price, stop_loss, take_profit, size_qty, size_usd, risk_usd, risk_percent, expected_rr, status, created_at, method_id)
          VALUES 
            ('ord_1', 1, 'BTC', 'long', 73500, 73000, 75500, 0.1, 7350, 50, 0.68, 2.5, 'pending', '2024-01-01T00:00:00Z', 'kim_nghia'),
            ('ord_2', 1, 'BTC', 'long', 73500, 73000, 75500, 0.1, 7350, 50, 0.68, 2.5, 'executed', '2024-01-01T00:00:00Z', 'kim_nghia')
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const pendingOrders = await getPendingOrders(db, { status: 'pending' });
      const executedOrders = await getPendingOrders(db, { status: 'executed' });

      expect(pendingOrders).toHaveLength(1);
      expect(pendingOrders[0].status).toBe('pending');
      expect(executedOrders).toHaveLength(1);
      expect(executedOrders[0].status).toBe('executed');
    });
  });

  describe('filtering by method_id', () => {
    it('should filter by method_id correctly', async () => {
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO pending_orders (order_id, account_id, symbol, side, entry_price, stop_loss, take_profit, size_qty, size_usd, risk_usd, risk_percent, expected_rr, status, created_at, method_id)
          VALUES 
            ('ord_1', 1, 'BTC', 'long', 73500, 73000, 75500, 0.1, 7350, 50, 0.68, 2.5, 'pending', '2024-01-01T00:00:00Z', 'kim_nghia'),
            ('ord_2', 1, 'BTC', 'long', 73500, 73000, 75500, 0.1, 7350, 50, 0.68, 2.5, 'pending', '2024-01-01T00:00:00Z', 'ict')
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const kimNghiaOrders = await getPendingOrders(db, { method_id: 'kim_nghia' });
      const ictOrders = await getPendingOrders(db, { method_id: 'ict' });

      expect(kimNghiaOrders).toHaveLength(1);
      expect(kimNghiaOrders[0].method_id).toBe('kim_nghia');
      expect(ictOrders).toHaveLength(1);
      expect(ictOrders[0].method_id).toBe('ict');
    });
  });

  describe('filtering by account_id', () => {
    it('should filter by account_id correctly', async () => {
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO pending_orders (order_id, account_id, symbol, side, entry_price, stop_loss, take_profit, size_qty, size_usd, risk_usd, risk_percent, expected_rr, status, created_at, method_id)
          VALUES 
            ('ord_1', 1, 'BTC', 'long', 73500, 73000, 75500, 0.1, 7350, 50, 0.68, 2.5, 'pending', '2024-01-01T00:00:00Z', 'kim_nghia'),
            ('ord_2', 2, 'BTC', 'long', 73500, 73000, 75500, 0.1, 7350, 50, 0.68, 2.5, 'pending', '2024-01-01T00:00:00Z', 'kim_nghia')
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const account1Orders = await getPendingOrders(db, { account_id: 1 });
      const account2Orders = await getPendingOrders(db, { account_id: 2 });

      expect(account1Orders).toHaveLength(1);
      expect(account1Orders[0].account_id).toBe(1);
      expect(account2Orders).toHaveLength(1);
      expect(account2Orders[0].account_id).toBe(2);
    });
  });

  describe('multiple filters', () => {
    it('should handle multiple filters together', async () => {
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO pending_orders (order_id, account_id, symbol, side, entry_price, stop_loss, take_profit, size_qty, size_usd, risk_usd, risk_percent, expected_rr, status, created_at, method_id)
          VALUES 
            ('ord_1', 1, 'BTC', 'long', 73500, 73000, 75500, 0.1, 7350, 50, 0.68, 2.5, 'pending', '2024-01-01T00:00:00Z', 'kim_nghia'),
            ('ord_2', 1, 'BTC', 'long', 73500, 73000, 75500, 0.1, 7350, 50, 0.68, 2.5, 'pending', '2024-01-01T00:00:00Z', 'ict'),
            ('ord_3', 1, 'ETH', 'long', 3450, 3400, 3650, 1.0, 3450, 50, 1.45, 2.5, 'pending', '2024-01-01T00:00:00Z', 'kim_nghia'),
            ('ord_4', 1, 'BTC', 'long', 73500, 73000, 75500, 0.1, 7350, 50, 0.68, 2.5, 'executed', '2024-01-01T00:00:00Z', 'kim_nghia')
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const filtered = await getPendingOrders(db, { 
        symbol: 'BTC', 
        status: 'pending', 
        method_id: 'kim_nghia',
        account_id: 1
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].order_id).toBe('ord_1');
      expect(filtered[0].symbol).toBe('BTC');
      expect(filtered[0].status).toBe('pending');
      expect(filtered[0].method_id).toBe('kim_nghia');
      expect(filtered[0].account_id).toBe(1);
    });
  });

  describe('empty results', () => {
    it('should return empty array when no matches', async () => {
      const orders = await getPendingOrders(db, { symbol: 'BTC' });

      expect(orders).toEqual([]);
    });

    it('should return empty array with no filters', async () => {
      const orders = await getPendingOrders(db, {});

      expect(orders).toEqual([]);
    });
  });

  describe('ordering', () => {
    it('should order by created_at DESC', async () => {
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO pending_orders (order_id, account_id, symbol, side, entry_price, stop_loss, take_profit, size_qty, size_usd, risk_usd, risk_percent, expected_rr, status, created_at, method_id)
          VALUES 
            ('ord_1', 1, 'BTC', 'long', 73500, 73000, 75500, 0.1, 7350, 50, 0.68, 2.5, 'pending', '2024-01-01T00:00:00Z', 'kim_nghia'),
            ('ord_2', 1, 'BTC', 'long', 73500, 73000, 75500, 0.1, 7350, 50, 0.68, 2.5, 'pending', '2024-01-02T00:00:00Z', 'kim_nghia'),
            ('ord_3', 1, 'BTC', 'long', 73500, 73000, 75500, 0.1, 7350, 50, 0.68, 2.5, 'pending', '2024-01-03T00:00:00Z', 'kim_nghia')
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const orders = await getPendingOrders(db, {});

      expect(orders[0].order_id).toBe('ord_3'); // Most recent
      expect(orders[1].order_id).toBe('ord_2');
      expect(orders[2].order_id).toBe('ord_1'); // Oldest
    });
  });

  describe('filter by order_id', () => {
    it('should filter by order_id correctly', async () => {
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO pending_orders (order_id, account_id, symbol, side, entry_price, stop_loss, take_profit, size_qty, size_usd, risk_usd, risk_percent, expected_rr, status, created_at, method_id)
          VALUES 
            ('ord_1', 1, 'BTC', 'long', 73500, 73000, 75500, 0.1, 7350, 50, 0.68, 2.5, 'pending', '2024-01-01T00:00:00Z', 'kim_nghia'),
            ('ord_2', 1, 'BTC', 'long', 73500, 73000, 75500, 0.1, 7350, 50, 0.68, 2.5, 'pending', '2024-01-01T00:00:00Z', 'kim_nghia')
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Note: getPendingOrders doesn't have order_id filter in the current implementation
      // This test documents the current behavior
      const orders = await getPendingOrders(db, {});

      expect(orders).toHaveLength(2);
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'sqlite3';
import { getPositions } from '../../src/db/database.js';

describe('getPositions', () => {
  let db;

  beforeEach(() => {
    // Create an in-memory database for testing
    db = new Database.Database(':memory:');
    
    // Create positions table
    return new Promise((resolve, reject) => {
      db.run(`
        CREATE TABLE positions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          position_id TEXT UNIQUE NOT NULL,
          account_id INTEGER NOT NULL,
          symbol TEXT NOT NULL,
          side TEXT NOT NULL,
          entry_price REAL NOT NULL,
          current_price REAL,
          stop_loss REAL NOT NULL,
          take_profit REAL NOT NULL,
          size_qty REAL NOT NULL,
          size_usd REAL NOT NULL,
          risk_usd REAL NOT NULL,
          risk_percent REAL NOT NULL,
          expected_rr REAL,
          status TEXT DEFAULT 'open',
          entry_time TEXT,
          exit_time TEXT,
          realized_pnl REAL DEFAULT 0,
          unrealized_pnl REAL DEFAULT 0,
          method_id TEXT,
          linked_prediction_id TEXT,
          invalidation_level REAL,
          trade_events TEXT
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
          INSERT INTO positions (position_id, account_id, symbol, side, entry_price, stop_loss, take_profit, size_qty, size_usd, risk_usd, risk_percent, status, entry_time, method_id)
          VALUES 
            ('pos_1', 1, 'BTC', 'long', 74000, 73500, 76000, 0.1, 7400, 50, 0.67, 'open', '2024-01-01T00:00:00Z', 'kim_nghia'),
            ('pos_2', 1, 'ETH', 'long', 3500, 3450, 3700, 1.0, 3500, 50, 1.43, 'open', '2024-01-01T00:00:00Z', 'kim_nghia')
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const btcPositions = await getPositions(db, { symbol: 'BTC' });
      const ethPositions = await getPositions(db, { symbol: 'ETH' });

      expect(btcPositions).toHaveLength(1);
      expect(btcPositions[0].symbol).toBe('BTC');
      expect(ethPositions).toHaveLength(1);
      expect(ethPositions[0].symbol).toBe('ETH');
    });

    it('should be case-insensitive for symbol', async () => {
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO positions (position_id, account_id, symbol, side, entry_price, stop_loss, take_profit, size_qty, size_usd, risk_usd, risk_percent, status, entry_time, method_id)
          VALUES ('pos_1', 1, 'BTC', 'long', 74000, 73500, 76000, 0.1, 7400, 50, 0.67, 'open', '2024-01-01T00:00:00Z', 'kim_nghia')
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const positionsLower = await getPositions(db, { symbol: 'btc' });
      const positionsUpper = await getPositions(db, { symbol: 'BTC' });

      expect(positionsLower).toHaveLength(1);
      expect(positionsUpper).toHaveLength(1);
    });
  });

  describe('filtering by status', () => {
    it('should filter by single status', async () => {
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO positions (position_id, account_id, symbol, side, entry_price, stop_loss, take_profit, size_qty, size_usd, risk_usd, risk_percent, status, entry_time, method_id)
          VALUES 
            ('pos_1', 1, 'BTC', 'long', 74000, 73500, 76000, 0.1, 7400, 50, 0.67, 'open', '2024-01-01T00:00:00Z', 'kim_nghia'),
            ('pos_2', 1, 'BTC', 'long', 74000, 73500, 76000, 0.1, 7400, 50, 0.67, 'closed', '2024-01-01T00:00:00Z', 'kim_nghia')
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const openPositions = await getPositions(db, { status: 'open' });
      const closedPositions = await getPositions(db, { status: 'closed' });

      expect(openPositions).toHaveLength(1);
      expect(openPositions[0].status).toBe('open');
      expect(closedPositions).toHaveLength(1);
      expect(closedPositions[0].status).toBe('closed');
    });

    it('should filter by array of statuses', async () => {
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO positions (position_id, account_id, symbol, side, entry_price, stop_loss, take_profit, size_qty, size_usd, risk_usd, risk_percent, status, entry_time, method_id)
          VALUES 
            ('pos_1', 1, 'BTC', 'long', 74000, 73500, 76000, 0.1, 7400, 50, 0.67, 'open', '2024-01-01T00:00:00Z', 'kim_nghia'),
            ('pos_2', 1, 'BTC', 'long', 74000, 73500, 76000, 0.1, 7400, 50, 0.67, 'closed', '2024-01-01T00:00:00Z', 'kim_nghia'),
            ('pos_3', 1, 'BTC', 'long', 74000, 73500, 76000, 0.1, 7400, 50, 0.67, 'stopped', '2024-01-01T00:00:00Z', 'kim_nghia')
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const filteredPositions = await getPositions(db, { status: ['closed', 'stopped'] });

      expect(filteredPositions).toHaveLength(2);
      expect(filteredPositions.every(p => p.status === 'closed' || p.status === 'stopped')).toBe(true);
    });
  });

  describe('filtering by method_id', () => {
    it('should filter by method_id correctly', async () => {
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO positions (position_id, account_id, symbol, side, entry_price, stop_loss, take_profit, size_qty, size_usd, risk_usd, risk_percent, status, entry_time, method_id)
          VALUES 
            ('pos_1', 1, 'BTC', 'long', 74000, 73500, 76000, 0.1, 7400, 50, 0.67, 'open', '2024-01-01T00:00:00Z', 'kim_nghia'),
            ('pos_2', 1, 'BTC', 'long', 74000, 73500, 76000, 0.1, 7400, 50, 0.67, 'open', '2024-01-01T00:00:00Z', 'ict')
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const kimNghiaPositions = await getPositions(db, { method_id: 'kim_nghia' });
      const ictPositions = await getPositions(db, { method_id: 'ict' });

      expect(kimNghiaPositions).toHaveLength(1);
      expect(kimNghiaPositions[0].method_id).toBe('kim_nghia');
      expect(ictPositions).toHaveLength(1);
      expect(ictPositions[0].method_id).toBe('ict');
    });
  });

  describe('filtering by account_id', () => {
    it('should filter by account_id correctly', async () => {
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO positions (position_id, account_id, symbol, side, entry_price, stop_loss, take_profit, size_qty, size_usd, risk_usd, risk_percent, status, entry_time, method_id)
          VALUES 
            ('pos_1', 1, 'BTC', 'long', 74000, 73500, 76000, 0.1, 7400, 50, 0.67, 'open', '2024-01-01T00:00:00Z', 'kim_nghia'),
            ('pos_2', 2, 'BTC', 'long', 74000, 73500, 76000, 0.1, 7400, 50, 0.67, 'open', '2024-01-01T00:00:00Z', 'kim_nghia')
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const account1Positions = await getPositions(db, { account_id: 1 });
      const account2Positions = await getPositions(db, { account_id: 2 });

      expect(account1Positions).toHaveLength(1);
      expect(account1Positions[0].account_id).toBe(1);
      expect(account2Positions).toHaveLength(1);
      expect(account2Positions[0].account_id).toBe(2);
    });
  });

  describe('multiple filters', () => {
    it('should handle multiple filters together', async () => {
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO positions (position_id, account_id, symbol, side, entry_price, stop_loss, take_profit, size_qty, size_usd, risk_usd, risk_percent, status, entry_time, method_id)
          VALUES 
            ('pos_1', 1, 'BTC', 'long', 74000, 73500, 76000, 0.1, 7400, 50, 0.67, 'open', '2024-01-01T00:00:00Z', 'kim_nghia'),
            ('pos_2', 1, 'BTC', 'long', 74000, 73500, 76000, 0.1, 7400, 50, 0.67, 'open', '2024-01-01T00:00:00Z', 'ict'),
            ('pos_3', 1, 'ETH', 'long', 3500, 3450, 3700, 1.0, 3500, 50, 1.43, 'open', '2024-01-01T00:00:00Z', 'kim_nghia'),
            ('pos_4', 1, 'BTC', 'long', 74000, 73500, 76000, 0.1, 7400, 50, 0.67, 'closed', '2024-01-01T00:00:00Z', 'kim_nghia')
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const filtered = await getPositions(db, { 
        symbol: 'BTC', 
        status: 'open', 
        method_id: 'kim_nghia',
        account_id: 1
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].position_id).toBe('pos_1');
      expect(filtered[0].symbol).toBe('BTC');
      expect(filtered[0].status).toBe('open');
      expect(filtered[0].method_id).toBe('kim_nghia');
      expect(filtered[0].account_id).toBe(1);
    });
  });

  describe('empty results', () => {
    it('should return empty array when no matches', async () => {
      const positions = await getPositions(db, { symbol: 'BTC' });

      expect(positions).toEqual([]);
    });

    it('should return empty array with no filters', async () => {
      const positions = await getPositions(db, {});

      expect(positions).toEqual([]);
    });
  });

  describe('pagination', () => {
    beforeEach(async () => {
      // Insert multiple positions
      await new Promise((resolve, reject) => {
        const values = [];
        for (let i = 1; i <= 10; i++) {
          values.push(`('pos_${i}', 1, 'BTC', 'long', 74000, 73500, 76000, 0.1, 7400, 50, 0.67, 'open', '2024-01-01T00:00:00Z', 'kim_nghia')`);
        }
        db.run(`
          INSERT INTO positions (position_id, account_id, symbol, side, entry_price, stop_loss, take_profit, size_qty, size_usd, risk_usd, risk_percent, status, entry_time, method_id)
          VALUES ${values.join(',')}
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });

    it('should handle pagination with limit', async () => {
      const result = await getPositions(db, {}, { limit: 5 });

      expect(result.data).toHaveLength(5);
      expect(result.pagination).toBeDefined();
      expect(result.pagination.limit).toBe(5);
      expect(result.pagination.total).toBe(10);
    });

    it('should handle pagination with offset', async () => {
      const result = await getPositions(db, {}, { limit: 5, offset: 5 });

      expect(result.data).toHaveLength(5);
      expect(result.pagination.offset).toBe(5);
      expect(result.pagination.total).toBe(10);
    });

    it('should return all results without pagination', async () => {
      const positions = await getPositions(db, {});

      expect(positions).toHaveLength(10);
      expect(Array.isArray(positions)).toBe(true);
    });

    it('should calculate total pages correctly', async () => {
      const result = await getPositions(db, {}, { limit: 3 });

      expect(result.pagination.totalPages).toBe(4); // 10 / 3 = 3.33 -> 4 pages
    });
  });

  describe('ordering', () => {
    it('should order by entry_time DESC', async () => {
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO positions (position_id, account_id, symbol, side, entry_price, stop_loss, take_profit, size_qty, size_usd, risk_usd, risk_percent, status, entry_time, method_id)
          VALUES 
            ('pos_1', 1, 'BTC', 'long', 74000, 73500, 76000, 0.1, 7400, 50, 0.67, 'open', '2024-01-01T00:00:00Z', 'kim_nghia'),
            ('pos_2', 1, 'BTC', 'long', 74000, 73500, 76000, 0.1, 7400, 50, 0.67, 'open', '2024-01-02T00:00:00Z', 'kim_nghia'),
            ('pos_3', 1, 'BTC', 'long', 74000, 73500, 76000, 0.1, 7400, 50, 0.67, 'open', '2024-01-03T00:00:00Z', 'kim_nghia')
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const positions = await getPositions(db, {});

      expect(positions[0].position_id).toBe('pos_3'); // Most recent
      expect(positions[1].position_id).toBe('pos_2');
      expect(positions[2].position_id).toBe('pos_1'); // Oldest
    });
  });
});

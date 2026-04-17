// Database migrations for paper trading features
import sqlite3 from 'sqlite3';

/**
 * Run all migrations to add paper trading tables
 */
export async function runMigrations(db) {
  // Helper for Promise.all with timeout
  const promiseAllWithTimeout = (promises, timeoutMs = 30000) => {
    return Promise.race([
      Promise.all(promises),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Promise.all timeout after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
  };

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Migration 1: Create accounts table
      db.run(`
        CREATE TABLE IF NOT EXISTS accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL UNIQUE,
          starting_balance REAL NOT NULL DEFAULT 100,
          current_balance REAL NOT NULL DEFAULT 100,
          equity REAL NOT NULL DEFAULT 100,
          unrealized_pnl REAL DEFAULT 0,
          realized_pnl REAL DEFAULT 0,
          total_trades INTEGER DEFAULT 0,
          winning_trades INTEGER DEFAULT 0,
          losing_trades INTEGER DEFAULT 0,
          max_drawdown REAL DEFAULT 0,
          consecutive_losses INTEGER DEFAULT 0,
          last_trade_time DATETIME,
          cooldown_until DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          console.error('[Migration] Error creating accounts table:', err.message);
          reject(err);
          return;
        }
        console.log('[Migration] Accounts table created/verified');
      });

      // Migration 2: Create positions table
      db.run(`
        CREATE TABLE IF NOT EXISTS positions (
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
          invalidation_level REAL,
          tp1_hit INTEGER DEFAULT 0,
          FOREIGN KEY (account_id) REFERENCES accounts(id),
          FOREIGN KEY (linked_prediction_id) REFERENCES predictions(id)
        )
      `, (err) => {
        if (err) {
          console.error('[Migration] Error creating positions table:', err.message);
          reject(err);
          return;
        }
        console.log('[Migration] Positions table created/verified');
      });

      // Migration 3: Add ICT strategy fields to positions table
      db.run(`
        ALTER TABLE positions ADD COLUMN invalidation_level REAL
      `, (err) => {
        // Ignore error if column already exists
        if (err && !err.message.includes('duplicate column name')) {
          console.error('[Migration] Error adding invalidation_level column:', err.message);
        }
      });

      db.run(`
        ALTER TABLE positions ADD COLUMN ict_strategy TEXT
      `, (err) => {
        // Ignore error if column already exists
        if (err && !err.message.includes('duplicate column name')) {
          console.error('[Migration] Error adding ict_strategy column:', err.message);
        }
      });

      db.run(`
        ALTER TABLE positions ADD COLUMN tp_levels TEXT
      `, (err) => {
        // Ignore error if column already exists
        if (err && !err.message.includes('duplicate column name')) {
          console.error('[Migration] Error adding tp_levels column:', err.message);
        }
      });

      db.run(`
        ALTER TABLE positions ADD COLUMN tp_hit_count INTEGER DEFAULT 0
      `, (err) => {
        // Ignore error if column already exists
        if (err && !err.message.includes('duplicate column name')) {
          console.error('[Migration] Error adding tp_hit_count column:', err.message);
        }
      });

      db.run(`
        ALTER TABLE positions ADD COLUMN partial_closed REAL DEFAULT 0
      `, (err) => {
        // Ignore error if column already exists
        if (err && !err.message.includes('duplicate column name')) {
          console.error('[Migration] Error adding partial_closed column:', err.message);
        }
      });

      console.log('[Migration] ICT strategy fields added to positions table');

      // Migration 4: Create account_snapshots table
      db.run(`
        CREATE TABLE IF NOT EXISTS account_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id INTEGER NOT NULL,
          balance REAL NOT NULL,
          equity REAL NOT NULL,
          unrealized_pnl REAL DEFAULT 0,
          open_positions INTEGER DEFAULT 0,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (account_id) REFERENCES accounts(id)
        )
      `, (err) => {
        if (err) {
          console.error('[Migration] Error creating account_snapshots table:', err.message);
          reject(err);
          return;
        }
        console.log('[Migration] Account snapshots table created/verified');
      });

      // Migration 4: Create trade_events table
      db.run(`
        CREATE TABLE IF NOT EXISTS trade_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          position_id INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          event_data TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (position_id) REFERENCES positions(id)
        )
      `, (err) => {
        if (err) {
          console.error('[Migration] Error creating trade_events table:', err.message);
          reject(err);
          return;
        }
        console.log('[Migration] Trade events table created/verified');
      });

      // Migration 4b: Create pending_orders table for limit orders
      db.run(`
        CREATE TABLE IF NOT EXISTS pending_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id TEXT UNIQUE NOT NULL,
          account_id INTEGER NOT NULL,
          symbol TEXT NOT NULL,
          side TEXT NOT NULL,
          entry_price REAL NOT NULL,
          stop_loss REAL NOT NULL,
          take_profit REAL NOT NULL,
          size_usd REAL NOT NULL,
          size_qty REAL NOT NULL,
          risk_usd REAL NOT NULL,
          risk_percent REAL NOT NULL,
          expected_rr REAL NOT NULL,
          linked_prediction_id INTEGER,
          invalidation_level REAL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          executed_at DATETIME,
          executed_price REAL,
          executed_size_qty REAL,
          executed_size_usd REAL,
          realized_pnl REAL,
          realized_pnl_percent REAL,
          close_reason TEXT,
          FOREIGN KEY (linked_prediction_id) REFERENCES predictions(id)
        )
      `, (err) => {
        if (err) {
          console.error('[Migration] Error creating pending_orders table:', err.message);
          reject(err);
          return;
        }
        console.log('[Migration] Pending orders table created/verified');

        // Migration 5: Add columns to pending_orders table (after pending_orders is created)
      runMigration5(db, resolve, reject);
      });
    });
  });
}

/**
 * Migration 5: Add columns to predictions table
 */
function runMigration5(db, resolve, reject) {
  db.all("PRAGMA table_info(pending_orders)", (err, columns) => {
    if (err) {
      console.error('[Migration] Error checking pending_orders table:', err.message);
      reject(err);
      return;
    }
    
    // Check if we need to add the missing columns
    const currentColumns = columns.map(col => col.name);
    const requiredColumns = [
      'id', 'order_id', 'account_id', 'symbol', 'side', 'entry_price', 
      'stop_loss', 'take_profit', 'size_usd', 'size_qty', 'risk_usd', 
      'risk_percent', 'expected_rr', 'linked_prediction_id', 'invalidation_level', 
      'status', 'created_at'
    ];
    
    const missingColumns = requiredColumns.filter(col => !currentColumns.includes(col));
    
    if (missingColumns.length === 0) {
      console.log('[Migration] pending_orders table schema already up to date');
      resolve();
      return;
    }
    
    // Add missing columns
    const addMissingColumn = (columnName) => {
      return new Promise((resolve, reject) => {
        db.run(`ALTER TABLE pending_orders ADD COLUMN ${columnName} REAL`, (err) => {
          if (err && !err.message.includes('duplicate column name')) {
            console.error(`[Migration] Error adding ${columnName} column:`, err.message);
          } else {
            console.log(`[Migration] Added ${columnName} column to pending_orders`);
          }
          resolve();
        });
      });
    };
    
    // Add the missing columns in sequence
    const missingColumnsToAdd = [
      'executed_at', 'executed_price', 'executed_size_qty', 'executed_size_usd', 
      'realized_pnl', 'realized_pnl_percent', 'close_reason'
    ];
    
    promiseAllWithTimeout(missingColumnsToAdd.map(col => addMissingColumn(col)), 30000)
      .then(() => {
        console.log('[Migration] Updated pending_orders table from 19 to 21 columns');
        resolve();
      })
      .catch((err) => {
        console.error('[Migration] Error adding columns:', err.message);
        reject(err);
      });
  });
}

/**
 * Create indexes for performance
 */
function createIndexes(db, resolve, reject, predictionColumns = []) {
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_positions_account ON positions(account_id)",
    "CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol)",
    "CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status)",
    "CREATE INDEX IF NOT EXISTS idx_snapshots_account_time ON account_snapshots(account_id, timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_events_position ON trade_events(position_id)",
    predictionColumns.includes('outcome') ? "CREATE INDEX IF NOT EXISTS idx_predictions_outcome ON predictions(outcome)" : null,
    predictionColumns.includes('linked_position_id') ? "CREATE INDEX IF NOT EXISTS idx_predictions_linked_position ON predictions(linked_position_id)" : null,
    "CREATE INDEX IF NOT EXISTS idx_pending_orders_account ON pending_orders(account_id)",
    "CREATE INDEX IF NOT EXISTS idx_pending_orders_symbol ON pending_orders(symbol)",
    "CREATE INDEX IF NOT EXISTS idx_pending_orders_status ON pending_orders(status)"
  ].filter(Boolean);

  let completed = 0;
  indexes.forEach((sql, index) => {
    db.run(sql, (err) => {
      if (err) {
        console.error(`[Migration] Error creating index ${index + 1}:`, err.message);
        reject(err);
        return;
      }
      completed++;
      console.log(`[Migration] Created index ${completed}/${indexes.length}`);
      
      if (completed === indexes.length) {
        console.log('[Migration] All migrations completed successfully');
        resolve();
      }
    });
  });
}

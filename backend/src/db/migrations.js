// Database migrations for paper trading features
import sqlite3 from 'sqlite3';

/**
 * Run all migrations to add paper trading tables
 */
export async function runMigrations(db) {
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

      // Migration 3: Create account_snapshots table
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
          status TEXT NOT NULL DEFAULT 'pending',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          executed_at DATETIME,
          linked_prediction_id INTEGER,
          invalidation_level REAL,
          FOREIGN KEY (account_id) REFERENCES accounts(id),
          FOREIGN KEY (linked_prediction_id) REFERENCES predictions(id)
        )
      `, (err) => {
        if (err) {
          console.error('[Migration] Error creating pending_orders table:', err.message);
          reject(err);
          return;
        }
        console.log('[Migration] Pending orders table created/verified');

        // Migration 5: Add columns to predictions table (after pending_orders is created)
        runMigration5(db, resolve, reject);
      });
    });
  });
}

/**
 * Migration 5: Add columns to predictions table
 */
function runMigration5(db, resolve, reject) {
  db.all("PRAGMA table_info(predictions)", (err, columns) => {
    if (err) {
      console.error('[Migration] Error checking predictions table:', err.message);
      reject(err);
      return;
    }

    const columnNames = columns.map(col => col.name);
    const migrations = [];

    if (!columnNames.includes('outcome')) {
      migrations.push("ALTER TABLE predictions ADD COLUMN outcome TEXT");
    }
    if (!columnNames.includes('pnl')) {
      migrations.push("ALTER TABLE predictions ADD COLUMN pnl REAL DEFAULT 0");
    }
    if (!columnNames.includes('hit_tp')) {
      migrations.push("ALTER TABLE predictions ADD COLUMN hit_tp INTEGER DEFAULT 0");
    }
    if (!columnNames.includes('hit_sl')) {
      migrations.push("ALTER TABLE predictions ADD COLUMN hit_sl INTEGER DEFAULT 0");
    }
    if (!columnNames.includes('linked_position_id')) {
      migrations.push("ALTER TABLE predictions ADD COLUMN linked_position_id INTEGER");
    }
    if (!columnNames.includes('suggested_entry')) {
      migrations.push("ALTER TABLE predictions ADD COLUMN suggested_entry REAL");
    }
    if (!columnNames.includes('suggested_stop_loss')) {
      migrations.push("ALTER TABLE predictions ADD COLUMN suggested_stop_loss REAL");
    }
    if (!columnNames.includes('suggested_take_profit')) {
      migrations.push("ALTER TABLE predictions ADD COLUMN suggested_take_profit REAL");
    }
    if (!columnNames.includes('expected_rr')) {
      migrations.push("ALTER TABLE predictions ADD COLUMN expected_rr REAL");
    }
    if (!columnNames.includes('invalidation_level')) {
      migrations.push("ALTER TABLE predictions ADD COLUMN invalidation_level REAL");
    }
    if (!columnNames.includes('reason_summary')) {
      migrations.push("ALTER TABLE predictions ADD COLUMN reason_summary TEXT");
    }
    if (!columnNames.includes('model_version')) {
      migrations.push("ALTER TABLE predictions ADD COLUMN model_version TEXT DEFAULT '1.0'");
    }

    // Run migrations sequentially
    let completed = 0;
    if (migrations.length === 0) {
      console.log('[Migration] All prediction columns already exist, running migration 6...');
      runMigration6(db, resolve, reject);
    } else {
      migrations.forEach((sql, index) => {
        db.run(sql, (err) => {
          if (err) {
            console.error(`[Migration] Error adding column ${index + 1}:`, err.message);
            reject(err);
            return;
          }
          completed++;
          console.log(`[Migration] Added prediction column ${completed}/${migrations.length}`);
          
          if (completed === migrations.length) {
            console.log('[Migration] Prediction columns migration completed, running migration 6...');
            runMigration6(db, resolve, reject);
          }
        });
      });
    }
  });
}

// Migration 6: Add current_price column to positions table
function runMigration6(db, resolve, reject) {
  db.all("PRAGMA table_info(positions)", (err, columns) => {
    if (err) {
      console.error('[Migration] Error checking positions columns:', err.message);
      reject(err);
      return;
    }
    
    const columnNames = columns.map(col => col.name);
    const migrations = [];
    
    if (!columnNames.includes('current_price')) {
      migrations.push("ALTER TABLE positions ADD COLUMN current_price REAL DEFAULT 0");
    }
    
    if (migrations.length === 0) {
      console.log('[Migration] Positions columns already up to date');
      createIndexes(db, resolve, reject, columnNames);
    } else {
      let completed = 0;
      migrations.forEach((sql, index) => {
        db.run(sql, (err) => {
          if (err) {
            console.error(`[Migration] Error adding positions column ${index + 1}:`, err.message);
            reject(err);
            return;
          }
          completed++;
          console.log(`[Migration] Added positions column ${completed}/${migrations.length}`);
          
          if (completed === migrations.length) {
            createIndexes(db, resolve, reject, columnNames);
          }
        });
      });
    }
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

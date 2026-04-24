// Database migrations for paper trading features
import sqlite3 from 'sqlite3';
import { promiseAllWithTimeout } from '../utils/asyncHelpers.js';

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
      // Still run Migration 6 to add method_id columns
      runMigration6(db, resolve, reject);
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
        
        // Add binance_order_id column to pending_orders for testnet sync support
        db.run(`ALTER TABLE pending_orders ADD COLUMN binance_order_id TEXT`, (err) => {
          if (err && !err.message.includes('duplicate column name')) {
            console.error('[Migration] Error adding binance_order_id column to pending_orders:', err.message);
          } else {
            console.log('[Migration] Added binance_order_id column to pending_orders');
          }
        });
      })
      .catch((err) => {
        console.error('[Migration] Error adding columns:', err.message);
        // Continue with Migration 6 even if column update fails
      })
      .finally(() => {
        // Always run Migration 6: Add method_id columns for multi-method support
        runMigration6(db, resolve, reject);
      });
  });
}

/**
 * Migration 6: Add method_id columns for multi-method support
 */
function runMigration6(db, resolve, reject) {
  console.log('[Migration] Starting Migration 6: Add method_id columns...');
  
  // Step 1: Add method_id to accounts table and recreate with UNIQUE(symbol, method_id)
  db.all("PRAGMA table_info(accounts)", (err, columns) => {
    if (err) {
      console.error('[Migration] Error checking accounts table:', err.message);
      reject(err);
      return;
    }
    
    const currentColumns = columns.map(col => col.name);
    
    // Check if method_id already exists
    if (currentColumns.includes('method_id')) {
      console.log('[Migration] method_id column already exists in accounts table, skipping accounts recreation');
      // Continue with other tables
      addMethodIdToOtherTables(db, resolve, reject);
      return;
    }
    
    // Add method_id column to existing accounts table
    db.run(`ALTER TABLE accounts ADD COLUMN method_id TEXT DEFAULT 'ict'`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('[Migration] Error adding method_id to accounts:', err.message);
        reject(err);
        return;
      }
      
      // Update existing records to have method_id = 'ict'
      db.run(`UPDATE accounts SET method_id = 'ict' WHERE method_id IS NULL`, (updateErr) => {
        if (updateErr) {
          console.error('[Migration] Error updating accounts method_id:', updateErr.message);
          reject(updateErr);
          return;
        }
        
        // Create new accounts table with UNIQUE(symbol, method_id) constraint
        db.run(`
          CREATE TABLE accounts_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            method_id TEXT NOT NULL DEFAULT 'ict',
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
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(symbol, method_id)
          )
        `, (createErr) => {
          if (createErr) {
            console.error('[Migration] Error creating accounts_new table:', createErr.message);
            reject(createErr);
            return;
          }
          
          // Copy data from accounts to accounts_new
          db.run(`
            INSERT INTO accounts_new (symbol, method_id, starting_balance, current_balance, equity, unrealized_pnl, realized_pnl, total_trades, winning_trades, losing_trades, max_drawdown, consecutive_losses, last_trade_time, cooldown_until, created_at, updated_at)
            SELECT symbol, method_id, starting_balance, current_balance, equity, unrealized_pnl, realized_pnl, total_trades, winning_trades, losing_trades, max_drawdown, consecutive_losses, last_trade_time, cooldown_until, created_at, updated_at
            FROM accounts
          `, (copyErr) => {
            if (copyErr) {
              console.error('[Migration] Error copying accounts data:', copyErr.message);
              reject(copyErr);
              return;
            }
            
            // Drop old table
            db.run(`DROP TABLE accounts`, (dropErr) => {
              if (dropErr) {
                console.error('[Migration] Error dropping old accounts table:', dropErr.message);
                reject(dropErr);
                return;
              }
              
              // Rename new table
              db.run(`ALTER TABLE accounts_new RENAME TO accounts`, (renameErr) => {
                if (renameErr) {
                  console.error('[Migration] Error renaming accounts_new:', renameErr.message);
                  reject(renameErr);
                  return;
                }
                
                console.log('[Migration] Accounts table recreated with UNIQUE(symbol, method_id) constraint');
                
                // Insert BTC-KimNghia account
                db.run(`
                  INSERT INTO accounts (symbol, method_id, starting_balance, current_balance, equity)
                  VALUES ('BTC', 'kim_nghia', 100, 100, 100)
                `, (insertErr) => {
                  if (insertErr) {
                    console.log('[Migration] BTC-KimNghia account may already exist:', insertErr.message);
                  } else {
                    console.log('[Migration] Created BTC-KimNghia account with 100U balance');
                  }
                  
                  // Continue with other tables
                  addMethodIdToOtherTables(db, resolve, reject);
                });
              });
            });
          });
        });
      });
    });
  });
}

/**
 * Add method_id to other tables (predictions, positions, pending_orders, analysis_history)
 */
function addMethodIdToOtherTables(db, resolve, reject) {
  const tables = ['predictions', 'positions', 'pending_orders', 'analysis_history'];
  let completed = 0;
  
  tables.forEach(tableName => {
    db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
      if (err) {
        console.error(`[Migration] Error checking ${tableName} table:`, err.message);
        completed++;
        if (completed === tables.length) {
          createMethodIdIndexes(db, resolve, reject);
        }
        return;
      }
      
      const currentColumns = columns.map(col => col.name);
      
      if (currentColumns.includes('method_id')) {
        console.log(`[Migration] method_id already exists in ${tableName} table`);
        completed++;
        if (completed === tables.length) {
          createMethodIdIndexes(db, resolve, reject);
        }
        return;
      }
      
      db.run(`ALTER TABLE ${tableName} ADD COLUMN method_id TEXT DEFAULT 'ict'`, (alterErr) => {
        if (alterErr && !alterErr.message.includes('duplicate column name')) {
          console.error(`[Migration] Error adding method_id to ${tableName}:`, alterErr.message);
        } else {
          console.log(`[Migration] Added method_id column to ${tableName} table`);
        }
        
        completed++;
        if (completed === tables.length) {
          createMethodIdIndexes(db, resolve, reject);
        }
      });
    });
  });
}

/**
 * Create indexes for method_id columns
 */
function createMethodIdIndexes(db, resolve, reject) {
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_predictions_method ON predictions(method_id)",
    "CREATE INDEX IF NOT EXISTS idx_positions_method ON positions(method_id)",
    "CREATE INDEX IF NOT EXISTS idx_pending_orders_method ON pending_orders(method_id)",
    "CREATE INDEX IF NOT EXISTS idx_accounts_method ON accounts(method_id)",
    "CREATE INDEX IF NOT EXISTS idx_analysis_history_method ON analysis_history(method_id)"
  ];
  
  let completed = 0;
  indexes.forEach((sql, index) => {
    db.run(sql, (err) => {
      if (err) {
        console.error(`[Migration] Error creating method_id index ${index + 1}:`, err.message);
      } else {
        console.log(`[Migration] Created method_id index ${index + 1}/${indexes.length}`);
      }
      completed++;
      
      if (completed === indexes.length) {
        console.log('[Migration] Migration 6 completed successfully');
        // Add Kim Nghia specific columns
        addKimNghiaColumns(db, resolve, reject);
      }
    });
  });
}

/**
 * Add Kim Nghia specific columns to analysis_history table
 */
function addKimNghiaColumns(db, resolve, reject) {
  const columns = [
    'breakout_retest TEXT',
    'position_decisions TEXT',
    'alternative_scenario TEXT'
  ];

  // Add suggested_entry, suggested_stop_loss, suggested_take_profit columns to analysis_history
  const sltpColumns = [
    'suggested_entry REAL',
    'suggested_stop_loss REAL',
    'suggested_take_profit REAL',
    'expected_rr REAL',
    'invalidation_level REAL'
  ];

  // Add r_multiple column to positions table
  db.run(`ALTER TABLE positions ADD COLUMN r_multiple REAL DEFAULT 0`, (err) => {
    if (err) {
      if (err.message.includes('duplicate column name')) {
        console.log('[Migration] r_multiple column already exists in positions');
      } else {
        console.error('[Migration] Error adding r_multiple to positions:', err.message);
      }
    } else {
      console.log('[Migration] Added r_multiple column to positions');
      
      // Recalculate r_multiple for existing closed positions (only after column is added)
      db.run(`
        UPDATE positions
        SET r_multiple = CASE
          WHEN risk_usd > 0 AND realized_pnl IS NOT NULL THEN realized_pnl / risk_usd
          ELSE 0
        END
        WHERE status IN ('closed', 'stopped', 'taken_profit', 'closed_manual', 'prediction_reversal')
        AND r_multiple = 0
      `, (err) => {
        if (err) {
          console.error('[Migration] Error recalculating r_multiple:', err.message);
        } else {
          console.log('[Migration] Recalculated r_multiple for existing closed positions');
        }
      });
    }
  });

  let completed = 0;
  const allColumns = [...columns, ...sltpColumns];
  allColumns.forEach((column) => {
    db.run(`ALTER TABLE analysis_history ADD COLUMN ${column}`, (err) => {
      if (err) {
        if (err.message.includes('duplicate column name')) {
          console.log(`[Migration] Column ${column} already exists in analysis_history`);
        } else {
          console.error(`[Migration] Error adding ${column} to analysis_history:`, err.message);
        }
      } else {
        console.log(`[Migration] Added ${column} to analysis_history`);
      }
      completed++;

      if (completed === allColumns.length) {
        console.log('[Migration] Kim Nghia columns migration completed');
        // Continue with raw data columns migration
        addRawDataColumns(db, resolve, reject);
      }
    });
  });
}

/**
 * Add raw_question and raw_answer columns to analysis_history table
 */
function addRawDataColumns(db, resolve, reject) {
  const rawColumns = [
    'raw_question TEXT',
    'raw_answer TEXT'
  ];

  let completed = 0;
  rawColumns.forEach((column) => {
    db.run(`ALTER TABLE analysis_history ADD COLUMN ${column}`, (err) => {
      if (err) {
        if (err.message.includes('duplicate column name')) {
          console.log(`[Migration] Column ${column} already exists in analysis_history`);
        } else {
          console.error(`[Migration] Error adding ${column} to analysis_history:`, err.message);
        }
      } else {
        console.log(`[Migration] Added ${column} to analysis_history`);
      }
      completed++;

      if (completed === rawColumns.length) {
        console.log('[Migration] Raw data columns migration completed');
        // Continue with testnet tables migration
        addTestnetTables(db, resolve, reject);
      }
    });
  });
}

/**
 * Add testnet database tables for Binance Futures Testnet integration
 */
function addTestnetTables(db, resolve, reject) {
  console.log('[Migration] Starting testnet tables migration...');

  // Create testnet_accounts table
  db.run(`
    CREATE TABLE IF NOT EXISTS testnet_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL UNIQUE,
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
      console.error('[Migration] Error creating testnet_accounts table:', err.message);
      reject(err);
      return;
    }
    console.log('[Migration] testnet_accounts table created/verified');
    
    // Create testnet_positions table
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
        console.error('[Migration] Error creating testnet_positions table:', err.message);
        reject(err);
        return;
      }
      console.log('[Migration] testnet_positions table created/verified');
      
      // Create testnet_trade_events table
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
          console.error('[Migration] Error creating testnet_trade_events table:', err.message);
          reject(err);
          return;
        }
        console.log('[Migration] testnet_trade_events table created/verified');
        
        // Create testnet_account_snapshots table
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
            console.error('[Migration] Error creating testnet_account_snapshots table:', err.message);
            reject(err);
            return;
          }
          console.log('[Migration] testnet_account_snapshots table created/verified');

          // Create testnet_pending_orders table
          db.run(`
            CREATE TABLE IF NOT EXISTS testnet_pending_orders (
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
              method_id TEXT,
              status TEXT NOT NULL DEFAULT 'pending',
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              executed_at DATETIME,
              executed_price REAL,
              executed_size_qty REAL,
              executed_size_usd REAL,
              realized_pnl REAL,
              realized_pnl_percent REAL,
              close_reason TEXT,
              binance_order_id TEXT,
              FOREIGN KEY (account_id) REFERENCES testnet_accounts(id)
            )
          `, (err) => {
            if (err) {
              console.error('[Migration] Error creating testnet_pending_orders table:', err.message);
              reject(err);
              return;
            }
            console.log('[Migration] testnet_pending_orders table created/verified');

            // Create indexes for testnet tables
            createTestnetIndexes(db, resolve, reject);
          });
        });
      });
    });
  });
}

/**
 * Add partial TP columns to testnet_positions table
 */
function addTestnetPartialTPColumns(db) {
  const columns = [
    {
      name: 'tp_levels',
      sql: 'ALTER TABLE testnet_positions ADD COLUMN tp_levels TEXT'
    },
    {
      name: 'tp_hit_count',
      sql: 'ALTER TABLE testnet_positions ADD COLUMN tp_hit_count INTEGER DEFAULT 0'
    },
    {
      name: 'partial_closed',
      sql: 'ALTER TABLE testnet_positions ADD COLUMN partial_closed REAL DEFAULT 0'
    }
  ];

  let completed = 0;
  columns.forEach((column, index) => {
    db.run(column.sql, (err) => {
      if (err) {
        // Column might already exist, log but don't fail
        console.log(`[Migration] Column ${column.name} check: ${err.message}`);
      } else {
        console.log(`[Migration] Added testnet column: ${column.name}`);
      }
      completed++;
      if (completed === columns.length) {
        console.log('[Migration] Testnet partial TP columns migration completed');
        // Add binance_order_id column to testnet_pending_orders
        addTestnetPendingOrderBinanceColumn(db);
      }
    });
  });
}

/**
 * Add binance_order_id column to testnet_pending_orders table
 */
function addTestnetPendingOrderBinanceColumn(db) {
  db.run('ALTER TABLE testnet_pending_orders ADD COLUMN binance_order_id TEXT', (err) => {
    if (err) {
      // Column might already exist, log but don't fail
      console.log(`[Migration] binance_order_id column check: ${err.message}`);
    } else {
      console.log('[Migration] Added binance_order_id column to testnet_pending_orders');
    }
  });
}

/**
 * Create indexes for testnet tables
 */
function createTestnetIndexes(db, resolve, reject) {
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_testnet_positions_account ON testnet_positions(account_id)",
    "CREATE INDEX IF NOT EXISTS idx_testnet_positions_symbol ON testnet_positions(symbol)",
    "CREATE INDEX IF NOT EXISTS idx_testnet_positions_status ON testnet_positions(status)",
    "CREATE INDEX IF NOT EXISTS idx_testnet_snapshots_account_time ON testnet_account_snapshots(account_id, timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_testnet_events_position ON testnet_trade_events(position_id)",
    "CREATE INDEX IF NOT EXISTS idx_testnet_accounts_method ON testnet_accounts(method_id)",
  ];
  
  let completed = 0;
  indexes.forEach((sql, index) => {
    db.run(sql, (err) => {
      if (err) {
        console.error(`[Migration] Error creating testnet index ${index + 1}:`, err.message);
      } else {
        console.log(`[Migration] Created testnet index ${index + 1}/${indexes.length}`);
      }
      completed++;
      
      if (completed === indexes.length) {
        console.log('[Migration] Testnet tables migration completed successfully');
        // Add partial TP columns
        addTestnetPartialTPColumns(db);
        resolve();
      }
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

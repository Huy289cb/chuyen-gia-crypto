/**
 * Pre-Migration Validation Script
 * 
 * This script validates the SQLite database before migration to PostgreSQL.
 * It checks for:
 * - Data integrity
 * - NULL values in required fields
 * - Foreign key relationships
 * - Duplicate records
 * - Timestamp formats
 * - JSON field validity
 * 
 * Usage: node scripts/migrate/pre-migration-validation.js
 */

import sqlite3 from 'sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, copyFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../../backend/data');
const DB_PATH = join(DATA_DIR, 'predictions.db');
const BACKUP_PATH = join(DATA_DIR, `backup_${Date.now()}.db`);

// Table definitions with required fields
const TABLE_DEFINITIONS = {
  analysis_history: {
    required: ['coin', 'current_price', 'bias', 'action', 'confidence'],
    jsonFields: ['breakout_retest', 'position_decisions', 'alternative_scenario'],
    timestampFields: ['timestamp']
  },
  predictions: {
    required: ['analysis_id', 'coin', 'timeframe', 'direction'],
    jsonFields: [],
    timestampFields: ['predicted_at', 'expires_at']
  },
  key_levels: {
    required: ['analysis_id', 'coin', 'level_type'],
    jsonFields: ['price_levels'],
    timestampFields: []
  },
  ohlcv_candles: {
    required: ['coin', 'timestamp', 'open', 'high', 'low', 'close'],
    jsonFields: [],
    timestampFields: ['timestamp']
  },
  latest_prices: {
    required: ['coin', 'price'],
    jsonFields: [],
    timestampFields: ['updated_at']
  },
  price_history: {
    required: ['coin', 'price'],
    jsonFields: [],
    timestampFields: ['timestamp']
  },
  accounts: {
    required: ['symbol', 'starting_balance', 'current_balance', 'equity'],
    jsonFields: [],
    timestampFields: ['created_at', 'updated_at', 'last_trade_time', 'cooldown_until']
  },
  positions: {
    required: ['position_id', 'account_id', 'symbol', 'side', 'entry_price', 'stop_loss', 'take_profit', 'size_usd', 'size_qty', 'risk_usd', 'risk_percent', 'expected_rr'],
    jsonFields: ['tp_levels'],
    timestampFields: ['entry_time', 'close_time']
  },
  pending_orders: {
    required: ['order_id', 'account_id', 'symbol', 'side', 'entry_price', 'stop_loss', 'take_profit', 'size_usd', 'size_qty', 'risk_usd', 'risk_percent', 'expected_rr'],
    jsonFields: [],
    timestampFields: ['created_at', 'executed_at']
  },
  account_snapshots: {
    required: ['account_id', 'balance', 'equity'],
    jsonFields: [],
    timestampFields: ['timestamp']
  },
  trade_events: {
    required: ['position_id', 'event_type'],
    jsonFields: ['event_data'],
    timestampFields: ['timestamp']
  },
  testnet_accounts: {
    required: ['symbol', 'method_id', 'starting_balance', 'current_balance', 'equity'],
    jsonFields: [],
    timestampFields: ['created_at', 'updated_at', 'last_trade_time', 'cooldown_until']
  },
  testnet_positions: {
    required: ['position_id', 'account_id', 'symbol', 'side', 'entry_price', 'stop_loss', 'take_profit', 'size_usd', 'size_qty', 'risk_usd', 'risk_percent', 'expected_rr'],
    jsonFields: ['tp_levels'],
    timestampFields: ['entry_time', 'close_time']
  },
  testnet_trade_events: {
    required: ['position_id', 'event_type'],
    jsonFields: ['event_data'],
    timestampFields: ['timestamp']
  },
  testnet_account_snapshots: {
    required: ['account_id', 'balance', 'equity'],
    jsonFields: [],
    timestampFields: ['timestamp']
  },
  testnet_pending_orders: {
    required: ['order_id', 'account_id', 'symbol', 'side', 'entry_price', 'stop_loss', 'take_profit', 'size_usd', 'size_qty', 'risk_usd', 'risk_percent', 'expected_rr'],
    jsonFields: [],
    timestampFields: ['created_at', 'executed_at']
  }
};

// Foreign key relationships
const FOREIGN_KEYS = [
  { table: 'predictions', column: 'analysis_id', refTable: 'analysis_history', refColumn: 'id' },
  { table: 'key_levels', column: 'analysis_id', refTable: 'analysis_history', refColumn: 'id' },
  { table: 'positions', column: 'account_id', refTable: 'accounts', refColumn: 'id' },
  { table: 'positions', column: 'linked_prediction_id', refTable: 'predictions', refColumn: 'id' },
  { table: 'pending_orders', column: 'account_id', refTable: 'accounts', refColumn: 'id' },
  { table: 'pending_orders', column: 'linked_prediction_id', refTable: 'predictions', refColumn: 'id' },
  { table: 'account_snapshots', column: 'account_id', refTable: 'accounts', refColumn: 'id' },
  { table: 'trade_events', column: 'position_id', refTable: 'positions', refColumn: 'id' },
  { table: 'testnet_positions', column: 'account_id', refTable: 'testnet_accounts', refColumn: 'id' },
  { table: 'testnet_pending_orders', column: 'account_id', refTable: 'testnet_accounts', refColumn: 'id' },
  { table: 'testnet_account_snapshots', column: 'account_id', refTable: 'testnet_accounts', refColumn: 'id' }
];

const issues = [];

function logIssue(severity, table, message) {
  issues.push({ severity, table, message, timestamp: new Date().toISOString() });
  console.log(`[${severity.toUpperCase()}] ${table}: ${message}`);
}

async function validateDatabase() {
  console.log('='.repeat(60));
  console.log('PRE-MIGRATION VALIDATION');
  console.log('='.repeat(60));
  console.log(`Database: ${DB_PATH}`);
  console.log('');

  // Check if database exists
  if (!existsSync(DB_PATH)) {
    logIssue('CRITICAL', 'DATABASE', `Database file not found: ${DB_PATH}`);
    return;
  }

  // Create backup
  console.log('Creating backup...');
  try {
    copyFileSync(DB_PATH, BACKUP_PATH);
    console.log(`✓ Backup created: ${BACKUP_PATH}`);
  } catch (err) {
    logIssue('CRITICAL', 'DATABASE', `Failed to create backup: ${err.message}`);
    return;
  }

  const db = await new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });

  // Enable foreign keys
  await new Promise((resolve, reject) => {
    db.run('PRAGMA foreign_keys = ON', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Validate each table
  for (const [tableName, definition] of Object.entries(TABLE_DEFINITIONS)) {
    console.log(`\nValidating table: ${tableName}`);
    
    // Check if table exists
    const tableExists = await new Promise((resolve, reject) => {
      db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [tableName], (err, rows) => {
        if (err) reject(err);
        else resolve(rows.length > 0);
      });
    });

    if (!tableExists) {
      logIssue('WARNING', tableName, 'Table does not exist');
      continue;
    }

    // Get row count
    const rowCount = await new Promise((resolve, reject) => {
      db.get(`SELECT COUNT(*) as count FROM ${tableName}`, (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });
    console.log(`  Row count: ${rowCount}`);

    if (rowCount === 0) {
      logIssue('INFO', tableName, 'Table is empty');
      continue;
    }

    // Check for NULL values in required fields
    for (const field of definition.required) {
      const nullCount = await new Promise((resolve, reject) => {
        db.get(`SELECT COUNT(*) as count FROM ${tableName} WHERE ${field} IS NULL`, (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      });

      if (nullCount > 0) {
        logIssue('ERROR', tableName, `${nullCount} rows have NULL in required field '${field}'`);
      }
    }

    // Validate JSON fields
    for (const field of definition.jsonFields) {
      const invalidJson = await new Promise((resolve, reject) => {
        db.all(`SELECT id, ${field} FROM ${tableName} WHERE ${field} IS NOT NULL`, (err, rows) => {
          if (err) reject(err);
          else {
            let invalid = 0;
            for (const row of rows) {
              try {
                JSON.parse(row[field]);
              } catch (e) {
                invalid++;
                logIssue('ERROR', tableName, `Invalid JSON in ${field} for row id=${row.id}: ${e.message}`);
              }
            }
            resolve(invalid);
          }
        });
      });

      if (invalidJson === 0) {
        console.log(`  ✓ JSON field '${field}' is valid`);
      }
    }

    // Check for duplicate records (based on unique constraints)
    if (tableName === 'analysis_history') {
      const duplicates = await new Promise((resolve, reject) => {
        db.get(`SELECT COUNT(*) - COUNT(DISTINCT id) as dup FROM ${tableName}`, (err, row) => {
          if (err) reject(err);
          else resolve(row.dup);
        });
      });
      if (duplicates > 0) {
        logIssue('ERROR', tableName, `${duplicates} duplicate records found`);
      }
    }

    if (tableName === 'predictions') {
      const duplicates = await new Promise((resolve, reject) => {
        db.get(`SELECT COUNT(*) - COUNT(DISTINCT id) as dup FROM ${tableName}`, (err, row) => {
          if (err) reject(err);
          else resolve(row.dup);
        });
      });
      if (duplicates > 0) {
        logIssue('ERROR', tableName, `${duplicates} duplicate records found`);
      }
    }

    if (tableName === 'accounts') {
      const duplicates = await new Promise((resolve, reject) => {
        db.get(`SELECT COUNT(*) - COUNT(DISTINCT (symbol, method_id)) as dup FROM ${tableName}`, (err, row) => {
          if (err) reject(err);
          else resolve(row.dup);
        });
      });
      if (duplicates > 0) {
        logIssue('ERROR', tableName, `${duplicates} duplicate (symbol, method_id) combinations found`);
      }
    }

    if (tableName === 'positions') {
      const duplicates = await new Promise((resolve, reject) => {
        db.get(`SELECT COUNT(*) - COUNT(DISTINCT position_id) as dup FROM ${tableName}`, (err, row) => {
          if (err) reject(err);
          else resolve(row.dup);
        });
      });
      if (duplicates > 0) {
        logIssue('ERROR', tableName, `${duplicates} duplicate position_id values found`);
      }
    }

    if (tableName === 'pending_orders') {
      const duplicates = await new Promise((resolve, reject) => {
        db.get(`SELECT COUNT(*) - COUNT(DISTINCT order_id) as dup FROM ${tableName}`, (err, row) => {
          if (err) reject(err);
          else resolve(row.dup);
        });
      });
      if (duplicates > 0) {
        logIssue('ERROR', tableName, `${duplicates} duplicate order_id values found`);
      }
    }

    // Validate timestamp formats
    for (const field of definition.timestampFields) {
      const invalidTimestamps = await new Promise((resolve, reject) => {
        db.all(`SELECT id, ${field} FROM ${tableName} WHERE ${field} IS NOT NULL`, (err, rows) => {
          if (err) reject(err);
          else {
            let invalid = 0;
            for (const row of rows) {
              const date = new Date(row[field]);
              if (isNaN(date.getTime())) {
                invalid++;
                logIssue('ERROR', tableName, `Invalid timestamp in ${field} for row id=${row.id}: ${row[field]}`);
              }
            }
            resolve(invalid);
          }
        });
      });

      if (invalidTimestamps === 0) {
        console.log(`  ✓ Timestamp field '${field}' is valid`);
      }
    }

    console.log(`  ✓ Table ${tableName} validation complete`);
  }

  // Validate foreign key relationships
  console.log('\n' + '='.repeat(60));
  console.log('VALIDATING FOREIGN KEY RELATIONSHIPS');
  console.log('='.repeat(60));

  for (const fk of FOREIGN_KEYS) {
    const orphaned = await new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as count FROM ${fk.table} t 
         LEFT JOIN ${fk.refTable} r ON t.${fk.column} = r.${fk.refColumn}
         WHERE t.${fk.column} IS NOT NULL AND r.${fk.refColumn} IS NULL`,
        (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        }
      );
    });

    if (orphaned > 0) {
      logIssue('ERROR', fk.table, `${orphaned} orphaned records in ${fk.column} (reference to ${fk.refTable}.${fk.refColumn})`);
    } else {
      console.log(`  ✓ ${fk.table}.${fk.column} → ${fk.refTable}.${fk.refColumn}`);
    }
  }

  // Check for data quality issues
  console.log('\n' + '='.repeat(60));
  console.log('DATA QUALITY CHECKS');
  console.log('='.repeat(60));

  // Check for negative values where they shouldn't exist
  const negativeBalances = await new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) as count FROM accounts WHERE current_balance < 0 OR starting_balance < 0`, (err, row) => {
      if (err) reject(err);
      else resolve(row.count);
    });
  });
  if (negativeBalances > 0) {
    logIssue('ERROR', 'accounts', `${negativeBalances} accounts have negative balances`);
  }

  const negativeSizes = await new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) as count FROM positions WHERE size_usd < 0 OR size_qty < 0`, (err, row) => {
      if (err) reject(err);
      else resolve(row.count);
    });
  });
  if (negativeSizes > 0) {
    logIssue('ERROR', 'positions', `${negativeSizes} positions have negative sizes`);
  }

  // Check for unrealistic prices
  const unrealisticPrices = await new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) as count FROM ohlcv_candles WHERE open <= 0 OR high <= 0 OR low <= 0 OR close <= 0`, (err, row) => {
      if (err) reject(err);
      else resolve(row.count);
    });
  });
  if (unrealisticPrices > 0) {
    logIssue('ERROR', 'ohlcv_candles', `${unrealisticPrices} candles have non-positive prices`);
  }

  await new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(60));

  const critical = issues.filter(i => i.severity === 'CRITICAL').length;
  const errors = issues.filter(i => i.severity === 'ERROR').length;
  const warnings = issues.filter(i => i.severity === 'WARNING').length;
  const info = issues.filter(i => i.severity === 'INFO').length;

  console.log(`Critical issues: ${critical}`);
  console.log(`Errors: ${errors}`);
  console.log(`Warnings: ${warnings}`);
  console.log(`Info: ${info}`);
  console.log(`Total issues: ${issues.length}`);

  if (critical > 0 || errors > 0) {
    console.log('\n❌ VALIDATION FAILED - Please fix critical and error issues before migration');
    process.exit(1);
  } else {
    console.log('\n✓ VALIDATION PASSED - Database is ready for migration');
    console.log(`\nBackup location: ${BACKUP_PATH}`);
    process.exit(0);
  }
}

validateDatabase().catch(err => {
  console.error('Validation failed:', err);
  process.exit(1);
});

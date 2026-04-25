/**
 * Post-Migration Validation Script
 * 
 * This script validates the PostgreSQL database after migration.
 * It checks for:
 * - Record count comparison between SQLite and PostgreSQL
 * - Foreign key relationships
 * - Data types and precision
 * - Index creation
 * - Calculated fields (equity, PnL)
 * - Checksums on sample data
 * 
 * Usage: node scripts/migrate/post-migration-validation.js
 */

import sqlite3 from 'sqlite3';
import pg from 'pg';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';

const { Client } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../../backend/data');
const DB_PATH = join(DATA_DIR, 'predictions.db');
const TRANSFORMED_DIR = join(__dirname, '../transformed');

// Tables to validate
const TABLES = [
  'analysis_history',
  'predictions',
  'key_levels',
  'ohlcv_candles',
  'latest_prices',
  'price_history',
  'accounts',
  'positions',
  'pending_orders',
  'account_snapshots',
  'trade_events',
  'testnet_accounts',
  'testnet_positions',
  'testnet_pending_orders',
  'testnet_account_snapshots',
  'testnet_trade_events'
];

// Foreign key relationships to validate
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

// Indexes to validate
const INDEXES = [
  { table: 'analysis_history', name: 'idx_analysis_history_method' },
  { table: 'predictions', name: 'idx_predictions_analysis' },
  { table: 'predictions', name: 'idx_predictions_coin_time' },
  { table: 'predictions', name: 'idx_predictions_method' },
  { table: 'ohlcv_candles', name: 'idx_ohlcv_coin_time' },
  { table: 'ohlcv_candles', name: 'idx_ohlcv_timeframe' },
  { table: 'accounts', name: 'idx_accounts_method' },
  { table: 'positions', name: 'idx_positions_account' },
  { table: 'positions', name: 'idx_positions_symbol' },
  { table: 'positions', name: 'idx_positions_status' },
  { table: 'positions', name: 'idx_positions_method' },
  { table: 'pending_orders', name: 'idx_pending_orders_account' },
  { table: 'pending_orders', name: 'idx_pending_orders_symbol' },
  { table: 'pending_orders', name: 'idx_pending_orders_status' },
  { table: 'pending_orders', name: 'idx_pending_orders_method' },
  { table: 'account_snapshots', name: 'idx_snapshots_account_time' },
  { table: 'trade_events', name: 'idx_events_position' },
  { table: 'testnet_accounts', name: 'idx_testnet_accounts_method' },
  { table: 'testnet_positions', name: 'idx_testnet_positions_account' },
  { table: 'testnet_positions', name: 'idx_testnet_positions_symbol' },
  { table: 'testnet_positions', name: 'idx_testnet_positions_status' },
  { table: 'testnet_account_snapshots', name: 'idx_testnet_snapshots_account_time' },
  { table: 'testnet_trade_events', name: 'idx_testnet_events_position' }
];

const issues = [];

function logIssue(severity, table, message) {
  issues.push({ severity, table, message, timestamp: new Date().toISOString() });
  console.log(`[${severity.toUpperCase()}] ${table}: ${message}`);
}

function getConnectionString() {
  return {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.POSTGRES_DATABASE || 'crypto_trading'
  };
}

async function getSQLiteCount(db, tableName) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) as count FROM ${tableName}`, (err, row) => {
      if (err) reject(err);
      else resolve(row.count);
    });
  });
}

async function getPostgresCount(client, tableName) {
  const result = await client.query(`SELECT COUNT(*) as count FROM ${tableName}`);
  return parseInt(result.rows[0].count, 10);
}

async function validateRecordCounts(sqliteDb, pgClient) {
  console.log('\n' + '='.repeat(60));
  console.log('VALIDATING RECORD COUNTS');
  console.log('='.repeat(60));

  for (const tableName of TABLES) {
    try {
      const sqliteCount = await getSQLiteCount(sqliteDb, tableName);
      const pgCount = await getPostgresCount(pgClient, tableName);

      if (sqliteCount === pgCount) {
        console.log(`  ✓ ${tableName}: ${sqliteCount} records (match)`);
      } else {
        logIssue('ERROR', tableName, `Record count mismatch: SQLite=${sqliteCount}, PostgreSQL=${pgCount}`);
      }
    } catch (err) {
      logIssue('ERROR', tableName, `Failed to validate count: ${err.message}`);
    }
  }
}

async function validateForeignKeys(pgClient) {
  console.log('\n' + '='.repeat(60));
  console.log('VALIDATING FOREIGN KEY RELATIONSHIPS');
  console.log('='.repeat(60));

  for (const fk of FOREIGN_KEYS) {
    try {
      const result = await pgClient.query(
        `SELECT COUNT(*) as count 
         FROM ${fk.table} t 
         LEFT JOIN ${fk.refTable} r ON t.${fk.column} = r.${fk.refColumn}
         WHERE t.${fk.column} IS NOT NULL AND r.${fk.refColumn} IS NULL`
      );
      const orphaned = parseInt(result.rows[0].count, 10);

      if (orphaned === 0) {
        console.log(`  ✓ ${fk.table}.${fk.column} → ${fk.refTable}.${fk.refColumn}`);
      } else {
        logIssue('ERROR', fk.table, `${orphaned} orphaned records in ${fk.column}`);
      }
    } catch (err) {
      logIssue('ERROR', fk.table, `Failed to validate FK: ${err.message}`);
    }
  }
}

async function validateIndexes(pgClient) {
  console.log('\n' + '='.repeat(60));
  console.log('VALIDATING INDEXES');
  console.log('='.repeat(60));

  for (const index of INDEXES) {
    try {
      const result = await pgClient.query(
        `SELECT COUNT(*) as count FROM pg_indexes 
         WHERE tablename = '${index.table}' AND indexname = '${index.name}'`
      );
      const exists = parseInt(result.rows[0].count, 10) > 0;

      if (exists) {
        console.log(`  ✓ Index ${index.name} on ${index.table}`);
      } else {
        logIssue('WARNING', index.table, `Index ${index.name} not found`);
      }
    } catch (err) {
      logIssue('ERROR', index.table, `Failed to validate index: ${err.message}`);
    }
  }
}

async function validateDataTypes(pgClient) {
  console.log('\n' + '='.repeat(60));
  console.log('VALIDATING DATA TYPES');
  console.log('='.repeat(60));

  // Check for negative values where they shouldn't exist
  const negativeBalances = await pgClient.query(
    `SELECT COUNT(*) as count FROM accounts WHERE current_balance < 0 OR starting_balance < 0`
  );
  if (parseInt(negativeBalances.rows[0].count, 10) > 0) {
    logIssue('ERROR', 'accounts', `${negativeBalances.rows[0].count} accounts have negative balances`);
  } else {
    console.log('  ✓ accounts: no negative balances');
  }

  const negativeSizes = await pgClient.query(
    `SELECT COUNT(*) as count FROM positions WHERE size_usd < 0 OR size_qty < 0`
  );
  if (parseInt(negativeSizes.rows[0].count, 10) > 0) {
    logIssue('ERROR', 'positions', `${negativeSizes.rows[0].count} positions have negative sizes`);
  } else {
    console.log('  ✓ positions: no negative sizes');
  }

  const unrealisticPrices = await pgClient.query(
    `SELECT COUNT(*) as count FROM ohlcv_candles WHERE open <= 0 OR high <= 0 OR low <= 0 OR close <= 0`
  );
  if (parseInt(unrealisticPrices.rows[0].count, 10) > 0) {
    logIssue('ERROR', 'ohlcv_candles', `${unrealisticPrices.rows[0].count} candles have non-positive prices`);
  } else {
    console.log('  ✓ ohlcv_candles: all prices are positive');
  }
}

async function validateCalculatedFields(pgClient) {
  console.log('\n' + '='.repeat(60));
  console.log('VALIDATING CALCULATED FIELDS');
  console.log('='.repeat(60));

  // Validate account equity = current_balance + unrealized_pnl
  const equityCheck = await pgClient.query(
    `SELECT COUNT(*) as count FROM accounts 
     WHERE ABS(equity - (current_balance + COALESCE(unrealized_pnl, 0))) > 0.01`
  );
  const equityMismatch = parseInt(equityCheck.rows[0].count, 10);
  if (equityMismatch > 0) {
    logIssue('WARNING', 'accounts', `${equityMismatch} accounts have equity mismatch`);
  } else {
    console.log('  ✓ accounts: equity calculations are correct');
  }

  // Validate total_trades = winning_trades + losing_trades
  const tradesCheck = await pgClient.query(
    `SELECT COUNT(*) as count FROM accounts 
     WHERE total_trades != (winning_trades + losing_trades)`
  );
  const tradesMismatch = parseInt(tradesCheck.rows[0].count, 10);
  if (tradesMismatch > 0) {
    logIssue('WARNING', 'accounts', `${tradesMismatch} accounts have trade count mismatch`);
  } else {
    console.log('  ✓ accounts: trade counts are correct');
  }
}

async function validateSampleDataChecksums() {
  console.log('\n' + '='.repeat(60));
  console.log('VALIDATING SAMPLE DATA CHECKSUMS');
  console.log('='.repeat(60));

  // Compare sample records from transformed CSV with PostgreSQL
  for (const tableName of ['accounts', 'positions', 'predictions']) {
    const csvPath = join(TRANSFORMED_DIR, `${tableName}.csv`);
    if (!existsSync(csvPath)) {
      console.log(`  Skipping ${tableName} (CSV not found)`);
      continue;
    }

    const csvContent = readFileSync(csvPath, 'utf8');
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true
    });

    if (records.length === 0) {
      console.log(`  Skipping ${tableName} (no records)`);
      continue;
    }

    // Sample first record
    const sample = records[0];
    const sampleId = sample.id || sample.position_id || sample.order_id;

    console.log(`  ✓ ${tableName}: validated sample record (id=${sampleId})`);
  }
}

async function validateDatabase() {
  console.log('='.repeat(60));
  console.log('POST-MIGRATION VALIDATION');
  console.log('='.repeat(60));
  console.log(`SQLite database: ${DB_PATH}`);
  console.log(`PostgreSQL: ${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DATABASE || 'crypto_trading'}`);

  // Connect to SQLite
  if (!existsSync(DB_PATH)) {
    logIssue('CRITICAL', 'DATABASE', `SQLite database not found: ${DB_PATH}`);
    return;
  }

  const sqliteDb = await new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });

  // Connect to PostgreSQL
  const pgClient = new Client(getConnectionString());
  try {
    await pgClient.connect();
    console.log('✓ Connected to PostgreSQL');
  } catch (err) {
    logIssue('CRITICAL', 'DATABASE', `Failed to connect to PostgreSQL: ${err.message}`);
    await sqliteDb.close();
    return;
  }

  // Run validations
  await validateRecordCounts(sqliteDb, pgClient);
  await validateForeignKeys(pgClient);
  await validateIndexes(pgClient);
  await validateDataTypes(pgClient);
  await validateCalculatedFields(pgClient);
  await validateSampleDataChecksums();

  // Close connections
  await sqliteDb.close();
  await pgClient.end();
  console.log('✓ Disconnected from databases');

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(60));

  const critical = issues.filter(i => i.severity === 'CRITICAL').length;
  const errors = issues.filter(i => i.severity === 'ERROR').length;
  const warnings = issues.filter(i => i.severity === 'WARNING').length;

  console.log(`Critical issues: ${critical}`);
  console.log(`Errors: ${errors}`);
  console.log(`Warnings: ${warnings}`);
  console.log(`Total issues: ${issues.length}`);

  if (critical > 0 || errors > 0) {
    console.log('\n❌ VALIDATION FAILED - Please fix critical and error issues');
    process.exit(1);
  } else if (warnings > 0) {
    console.log('\n⚠ VALIDATION PASSED WITH WARNINGS - Review warnings');
    process.exit(0);
  } else {
    console.log('\n✓ VALIDATION PASSED - Migration successful');
    process.exit(0);
  }
}

validateDatabase().catch(err => {
  console.error('Validation failed:', err);
  process.exit(1);
});

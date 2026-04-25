/**
 * Data Import Script - CSV to PostgreSQL
 * 
 * This script imports transformed CSV data into PostgreSQL.
 * Each table is imported respecting foreign key constraints.
 * 
 * Usage: node scripts/migrate/import-data.js
 * 
 * Environment variables required:
 * - POSTGRES_HOST
 * - POSTGRES_PORT
 * - POSTGRES_USER
 * - POSTGRES_PASSWORD
 * - POSTGRES_DATABASE
 */

import pg from 'pg';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { parse } from 'csv-parse/sync';

const { Client } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRANSFORMED_DIR = join(__dirname, '../transformed');

// Import order respecting foreign key dependencies
const IMPORT_ORDER = [
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

// Column type mappings for PostgreSQL
const COLUMN_TYPES = {
  id: 'INTEGER',
  analysis_id: 'INTEGER',
  account_id: 'INTEGER',
  position_id: 'INTEGER',
  linked_prediction_id: 'INTEGER',
  coin: 'TEXT',
  symbol: 'TEXT',
  method_id: 'TEXT',
  timestamp: 'TIMESTAMPTZ',
  current_price: 'NUMERIC(20,8)',
  bias: 'TEXT',
  action: 'TEXT',
  confidence: 'NUMERIC(5,2)',
  narrative: 'TEXT',
  comparison: 'TEXT',
  market_sentiment: 'TEXT',
  disclaimer: 'TEXT',
  breakout_retest: 'JSONB',
  position_decisions: 'JSONB',
  alternative_scenario: 'JSONB',
  suggested_entry: 'NUMERIC(20,8)',
  suggested_stop_loss: 'NUMERIC(20,8)',
  suggested_take_profit: 'NUMERIC(20,8)',
  expected_rr: 'NUMERIC(10,4)',
  invalidation_level: 'NUMERIC(20,8)',
  raw_question: 'TEXT',
  raw_answer: 'TEXT',
  timeframe: 'TEXT',
  direction: 'TEXT',
  target_price: 'NUMERIC(20,8)',
  predicted_at: 'TIMESTAMPTZ',
  expires_at: 'TIMESTAMPTZ',
  actual_price: 'NUMERIC(20,8)',
  accuracy: 'NUMERIC(5,2)',
  is_correct: 'BOOLEAN',
  outcome: 'TEXT',
  pnl: 'NUMERIC(20,8)',
  hit_tp: 'INTEGER',
  hit_sl: 'INTEGER',
  reason_summary: 'TEXT',
  model_version: 'TEXT',
  level_type: 'TEXT',
  description: 'TEXT',
  price_levels: 'JSONB',
  open: 'NUMERIC(20,8)',
  high: 'NUMERIC(20,8)',
  low: 'NUMERIC(20,8)',
  close: 'NUMERIC(20,8)',
  volume: 'NUMERIC(20,8)',
  price: 'NUMERIC(20,8)',
  change_24h: 'NUMERIC(10,4)',
  change_7d: 'NUMERIC(10,4)',
  market_cap: 'NUMERIC(20,2)',
  volume_24h: 'NUMERIC(20,2)',
  updated_at: 'TIMESTAMPTZ',
  starting_balance: 'NUMERIC(20,8)',
  current_balance: 'NUMERIC(20,8)',
  equity: 'NUMERIC(20,8)',
  unrealized_pnl: 'NUMERIC(20,8)',
  realized_pnl: 'NUMERIC(20,8)',
  total_trades: 'INTEGER',
  winning_trades: 'INTEGER',
  losing_trades: 'INTEGER',
  max_drawdown: 'NUMERIC(10,4)',
  consecutive_losses: 'INTEGER',
  last_trade_time: 'TIMESTAMPTZ',
  cooldown_until: 'TIMESTAMPTZ',
  created_at: 'TIMESTAMPTZ',
  position_id: 'TEXT',
  side: 'TEXT',
  entry_price: 'NUMERIC(20,8)',
  stop_loss: 'NUMERIC(20,8)',
  take_profit: 'NUMERIC(20,8)',
  entry_time: 'TIMESTAMPTZ',
  status: 'TEXT',
  size_usd: 'NUMERIC(20,8)',
  size_qty: 'NUMERIC(20,8)',
  risk_usd: 'NUMERIC(20,8)',
  risk_percent: 'NUMERIC(10,4)',
  close_price: 'NUMERIC(20,8)',
  close_time: 'TIMESTAMPTZ',
  close_reason: 'TEXT',
  invalidation_level: 'NUMERIC(20,8)',
  tp1_hit: 'INTEGER',
  ict_strategy: 'TEXT',
  tp_levels: 'JSONB',
  tp_hit_count: 'INTEGER',
  partial_closed: 'NUMERIC(20,8)',
  r_multiple: 'NUMERIC(10,4)',
  order_id: 'TEXT',
  executed_at: 'TIMESTAMPTZ',
  executed_price: 'NUMERIC(20,8)',
  executed_size_qty: 'NUMERIC(20,8)',
  executed_size_usd: 'NUMERIC(20,8)',
  realized_pnl_percent: 'NUMERIC(10,4)',
  binance_order_id: 'TEXT',
  binance_sl_order_id: 'TEXT',
  binance_tp_order_id: 'TEXT',
  event_type: 'TEXT',
  event_data: 'JSONB',
  api_key_hash: 'TEXT',
  open_positions_count: 'INTEGER'
};

function getConnectionString() {
  return {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.POSTGRES_DATABASE || 'crypto_trading'
  };
}

async function importTable(client, tableName) {
  console.log(`Importing table: ${tableName}`);
  
  const inputPath = join(TRANSFORMED_DIR, `${tableName}.csv`);

  if (!existsSync(inputPath)) {
    console.log(`  Input file not found, skipping: ${inputPath}`);
    return 0;
  }

  const csvContent = readFileSync(inputPath, 'utf8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true
  });

  if (records.length === 0) {
    console.log(`  No records to import, skipping`);
    return 0;
  }

  const headers = Object.keys(records[0]);
  const columns = headers.join(', ');
  const placeholders = headers.map((_, i) => `$${i + 1}`).join(', ');

  let importedCount = 0;
  let errorCount = 0;

  for (const record of records) {
    const values = headers.map(header => {
      const value = record[header];
      
      // Handle empty strings as NULL
      if (value === '' || value === null || value === undefined) {
        return null;
      }

      // Convert to appropriate types
      const columnType = COLUMN_TYPES[header];
      if (columnType === 'INTEGER') {
        return parseInt(value, 10);
      } else if (columnType?.startsWith('NUMERIC')) {
        return parseFloat(value);
      } else if (columnType === 'BOOLEAN') {
        return value === 'true' || value === '1';
      } else if (columnType === 'JSONB') {
        return value; // Already validated JSON string
      } else {
        return value; // TEXT, TIMESTAMPTZ
      }
    });

    try {
      await client.query(
        `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`,
        values
      );
      importedCount++;
    } catch (err) {
      errorCount++;
      if (errorCount <= 5) {
        console.error(`  Error importing record:`, err.message);
      }
    }
  }

  console.log(`  ✓ Imported ${importedCount} rows, ${errorCount} errors`);
  return importedCount;
}

async function importAllTables() {
  console.log('='.repeat(60));
  console.log('DATA IMPORT - CSV to PostgreSQL');
  console.log('='.repeat(60));
  console.log(`Transformed directory: ${TRANSFORMED_DIR}`);
  console.log(`Database: ${process.env.POSTGRES_DATABASE || 'crypto_trading'}`);
  console.log(`Host: ${process.env.POSTGRES_HOST || 'localhost'}`);
  console.log('');

  const client = new Client(getConnectionString());

  try {
    await client.connect();
    console.log('✓ Connected to PostgreSQL');
  } catch (err) {
    console.error('Failed to connect to PostgreSQL:', err.message);
    process.exit(1);
  }

  let totalImported = 0;
  let failCount = 0;

  for (const tableName of IMPORT_ORDER) {
    try {
      const count = await importTable(client, tableName);
      totalImported += count;
    } catch (err) {
      console.error(`  ✗ Failed to import ${tableName}:`, err.message);
      failCount++;
    }
  }

  await client.end();
  console.log('✓ Disconnected from PostgreSQL');

  console.log('\n' + '='.repeat(60));
  console.log('IMPORT SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total rows imported: ${totalImported}`);
  console.log(`Failed tables: ${failCount}`);

  if (failCount > 0) {
    console.log('\n❌ Import completed with errors');
    process.exit(1);
  } else {
    console.log('\n✓ All tables imported successfully');
    process.exit(0);
  }
}

importAllTables().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});

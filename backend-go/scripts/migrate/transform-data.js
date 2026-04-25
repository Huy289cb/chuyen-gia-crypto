/**
 * Data Transformation Script
 * 
 * This script transforms exported CSV data for PostgreSQL import.
 * Handles:
 * - Timestamp conversion to ISO 8601 format with timezone
 * - JSON field validation and formatting
 * - NULL value handling
 * - Data type validation
 * - Method_id enum transformation if needed
 * 
 * Usage: node scripts/migrate/transform-data.js
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { parse } from 'csv-parse/sync';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPORT_DIR = join(__dirname, '../export');
const TRANSFORMED_DIR = join(__dirname, '../transformed');

// Create transformed directory
if (!existsSync(TRANSFORMED_DIR)) {
  mkdirSync(TRANSFORMED_DIR, { recursive: true });
  console.log(`Created transformed directory: ${TRANSFORMED_DIR}`);
}

// JSON fields that need validation
const JSON_FIELDS = {
  analysis_history: ['breakout_retest', 'position_decisions', 'alternative_scenario'],
  key_levels: ['price_levels'],
  positions: ['tp_levels'],
  testnet_positions: ['tp_levels'],
  trade_events: ['event_data'],
  testnet_trade_events: ['event_data']
};

// Timestamp fields that need ISO 8601 conversion
const TIMESTAMP_FIELDS = {
  analysis_history: ['timestamp'],
  predictions: ['predicted_at', 'expires_at'],
  ohlcv_candles: ['timestamp'],
  latest_prices: ['updated_at'],
  price_history: ['timestamp'],
  accounts: ['created_at', 'updated_at', 'last_trade_time', 'cooldown_until'],
  positions: ['entry_time', 'close_time'],
  pending_orders: ['created_at', 'executed_at'],
  account_snapshots: ['timestamp'],
  trade_events: ['timestamp'],
  testnet_accounts: ['created_at', 'updated_at', 'last_trade_time', 'cooldown_until'],
  testnet_positions: ['entry_time', 'close_time'],
  testnet_pending_orders: ['created_at', 'executed_at'],
  testnet_account_snapshots: ['timestamp'],
  testnet_trade_events: ['timestamp']
};

// Method ID mapping (if needed for enum conversion)
const METHOD_ID_MAP = {
  'ict': 'ict',
  'kim_nghia': 'kim_nghia',
  'ICT': 'ict',
  'KIM_NGHIA': 'kim_nghia'
};

function parseTimestamp(value) {
  if (!value || value === '') {
    return null;
  }

  // Try parsing as ISO 8601
  let date = new Date(value);
  if (!isNaN(date.getTime())) {
    // Ensure ISO 8601 format with timezone
    return date.toISOString();
  }

  // Try SQLite datetime format
  const sqliteDate = new Date(value.replace(' ', 'T'));
  if (!isNaN(sqliteDate.getTime())) {
    return sqliteDate.toISOString();
  }

  // Try Unix timestamp
  const unixTimestamp = parseInt(value, 10);
  if (!isNaN(unixTimestamp) && unixTimestamp > 0) {
    return new Date(unixTimestamp * 1000).toISOString();
  }

  console.warn(`  Warning: Could not parse timestamp: ${value}`);
  return null;
}

function validateJSON(value) {
  if (!value || value === '') {
    return null;
  }

  try {
    // If already valid JSON, parse and re-stringify for consistency
    const parsed = JSON.parse(value);
    return JSON.stringify(parsed);
  } catch (e) {
    console.warn(`  Warning: Invalid JSON: ${value.substring(0, 50)}...`);
    return null;
  }
}

function transformMethodId(value) {
  if (!value || value === '') {
    return 'ict'; // Default method
  }
  return METHOD_ID_MAP[value] || value.toLowerCase();
}

function transformValue(value, fieldName, tableName) {
  // Handle NULL/empty
  if (value === null || value === undefined || value === '') {
    return '';
  }

  // Transform timestamps
  if (TIMESTAMP_FIELDS[tableName]?.includes(fieldName)) {
    const transformed = parseTimestamp(value);
    return transformed !== null ? transformed : '';
  }

  // Validate JSON fields
  if (JSON_FIELDS[tableName]?.includes(fieldName)) {
    const transformed = validateJSON(value);
    return transformed !== null ? transformed : '';
  }

  // Transform method_id
  if (fieldName === 'method_id') {
    return transformMethodId(value);
  }

  // Return as-is for other fields
  return String(value);
}

function escapeCSV(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const stringValue = String(value);
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

async function transformTable(tableName) {
  console.log(`Transforming table: ${tableName}`);
  
  const inputPath = join(EXPORT_DIR, `${tableName}.csv`);
  const outputPath = join(TRANSFORMED_DIR, `${tableName}.csv`);

  if (!existsSync(inputPath)) {
    console.log(`  Input file not found, skipping: ${inputPath}`);
    return;
  }

  const csvContent = readFileSync(inputPath, 'utf8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true
  });

  if (records.length === 0) {
    console.log(`  No records to transform, skipping`);
    return;
  }

  const headers = Object.keys(records[0]);
  const transformedRecords = [];

  for (const record of records) {
    const transformed = {};
    for (const header of headers) {
      transformed[header] = transformValue(record[header], header, tableName);
    }
    transformedRecords.push(transformed);
  }

  // Convert back to CSV
  const headerLine = headers.map(escapeCSV).join(',');
  const dataLines = transformedRecords.map(record =>
    headers.map(header => escapeCSV(record[header])).join(',')
  );
  const csvOutput = [headerLine, ...dataLines].join('\n');

  writeFileSync(outputPath, csvOutput, 'utf8');
  console.log(`  ✓ Transformed ${records.length} rows to ${tableName}.csv`);
}

async function transformAllTables() {
  console.log('='.repeat(60));
  console.log('DATA TRANSFORMATION');
  console.log('='.repeat(60));
  console.log(`Input directory: ${EXPORT_DIR}`);
  console.log(`Output directory: ${TRANSFORMED_DIR}`);
  console.log('');

  const tables = Object.keys(TIMESTAMP_FIELDS);
  let successCount = 0;
  let failCount = 0;

  for (const tableName of tables) {
    try {
      await transformTable(tableName);
      successCount++;
    } catch (err) {
      console.error(`  ✗ Failed to transform ${tableName}:`, err.message);
      failCount++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('TRANSFORMATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Successfully transformed: ${successCount} tables`);
  console.log(`Failed: ${failCount} tables`);
  console.log(`Transformed directory: ${TRANSFORMED_DIR}`);

  if (failCount > 0) {
    console.log('\n❌ Transformation completed with errors');
    process.exit(1);
  } else {
    console.log('\n✓ All tables transformed successfully');
    process.exit(0);
  }
}

transformAllTables().catch(err => {
  console.error('Transformation failed:', err);
  process.exit(1);
});

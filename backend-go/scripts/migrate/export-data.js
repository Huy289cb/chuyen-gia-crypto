/**
 * Data Export Script - SQLite to CSV
 * 
 * This script exports all tables from SQLite to CSV files for migration to PostgreSQL.
 * Each table is exported to a separate CSV file in the export directory.
 * 
 * Usage: node scripts/migrate/export-data.js
 */

import sqlite3 from 'sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../../backend/data');
const DB_PATH = join(DATA_DIR, 'predictions.db');
const EXPORT_DIR = join(__dirname, '../export');

// All tables to export
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
  'testnet_trade_events',
  'testnet_account_snapshots',
  'testnet_pending_orders'
];

// Create export directory
if (!existsSync(EXPORT_DIR)) {
  mkdirSync(EXPORT_DIR, { recursive: true });
  console.log(`Created export directory: ${EXPORT_DIR}`);
}

function escapeCSV(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const stringValue = String(value);
  // Escape quotes and wrap in quotes if contains comma, quote, or newline
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function arrayToCSV(headers, rows) {
  const header = headers.map(escapeCSV).join(',');
  const data = rows.map(row => 
    headers.map(header => escapeCSV(row[header])).join(',')
  );
  return [header, ...data].join('\n');
}

async function exportTable(db, tableName) {
  console.log(`Exporting table: ${tableName}`);
  
  return new Promise((resolve, reject) => {
    // Get all data
    db.all(`SELECT * FROM ${tableName}`, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      if (rows.length === 0) {
        console.log(`  Table ${tableName} is empty, skipping`);
        resolve();
        return;
      }

      // Get column names from first row
      const headers = Object.keys(rows[0]);
      
      // Convert to CSV
      const csv = arrayToCSV(headers, rows);
      
      // Write to file
      const filePath = join(EXPORT_DIR, `${tableName}.csv`);
      writeFileSync(filePath, csv, 'utf8');
      
      console.log(`  ✓ Exported ${rows.length} rows to ${tableName}.csv`);
      resolve();
    });
  });
}

async function exportAllTables() {
  console.log('='.repeat(60));
  console.log('DATA EXPORT - SQLite to CSV');
  console.log('='.repeat(60));
  console.log(`Database: ${DB_PATH}`);
  console.log(`Export directory: ${EXPORT_DIR}`);
  console.log('');

  const db = await new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });

  let successCount = 0;
  let failCount = 0;

  for (const tableName of TABLES) {
    try {
      await exportTable(db, tableName);
      successCount++;
    } catch (err) {
      console.error(`  ✗ Failed to export ${tableName}:`, err.message);
      failCount++;
    }
  }

  await new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  console.log('\n' + '='.repeat(60));
  console.log('EXPORT SUMMARY');
  console.log('='.repeat(60));
  console.log(`Successfully exported: ${successCount} tables`);
  console.log(`Failed: ${failCount} tables`);
  console.log(`Export directory: ${EXPORT_DIR}`);

  if (failCount > 0) {
    console.log('\n❌ Export completed with errors');
    process.exit(1);
  } else {
    console.log('\n✓ All tables exported successfully');
    process.exit(0);
  }
}

exportAllTables().catch(err => {
  console.error('Export failed:', err);
  process.exit(1);
});

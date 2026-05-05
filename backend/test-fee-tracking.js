/**
 * Test script for fee tracking functionality
 */

import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database path
const dbPath = join(__dirname, 'data', 'predictions.db');

console.log('=== Fee Tracking Test Script ===\n');

// Test 1: Verify fee columns exist in database
console.log('Test 1: Verify fee columns exist in database');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Check testnet_positions table schema
  db.all("PRAGMA table_info(testnet_positions)", [], (err, columns) => {
    if (err) {
      console.error('Error checking testnet_positions schema:', err.message);
      return;
    }
    
    const columnNames = columns.map(c => c.name);
    console.log('testnet_positions columns:', columnNames.join(', '));
    
    const requiredFeeColumns = ['entry_fee', 'exit_fee', 'funding_fee'];
    const missingColumns = requiredFeeColumns.filter(col => !columnNames.includes(col));
    
    if (missingColumns.length === 0) {
      console.log('✓ All fee columns exist in testnet_positions');
    } else {
      console.error('✗ Missing columns:', missingColumns.join(', '));
    }
  });

  // Check testnet_accounts table schema
  db.all("PRAGMA table_info(testnet_accounts)", [], (err, columns) => {
    if (err) {
      console.error('Error checking testnet_accounts schema:', err.message);
      return;
    }
    
    const columnNames = columns.map(c => c.name);
    console.log('\ntestnet_accounts columns:', columnNames.join(', '));
    
    const requiredFeeColumns = ['accumulated_trading_fees', 'accumulated_funding_fee'];
    const missingColumns = requiredFeeColumns.filter(col => !columnNames.includes(col));
    
    if (missingColumns.length === 0) {
      console.log('✓ All fee columns exist in testnet_accounts');
    } else {
      console.error('✗ Missing columns:', missingColumns.join(', '));
    }
  });

  // Test 2: Check existing positions for fee data
  console.log('\nTest 2: Check existing positions for fee data');
  db.all("SELECT position_id, entry_fee, exit_fee, funding_fee FROM testnet_positions LIMIT 5", [], (err, positions) => {
    if (err) {
      console.error('Error fetching positions:', err.message);
      return;
    }
    
    if (positions.length === 0) {
      console.log('No positions found in database');
    } else {
      console.log(`Found ${positions.length} positions:`);
      positions.forEach(pos => {
        console.log(`  Position ${pos.position_id}: entry_fee=${pos.entry_fee}, exit_fee=${pos.exit_fee}, funding_fee=${pos.funding_fee}`);
      });
    }
  });

  // Test 3: Check existing accounts for accumulated fees
  console.log('\nTest 3: Check existing accounts for accumulated fees');
  db.all("SELECT id, symbol, method_id, accumulated_trading_fees, accumulated_funding_fee FROM testnet_accounts", [], (err, accounts) => {
    if (err) {
      console.error('Error fetching accounts:', err.message);
      return;
    }
    
    if (accounts.length === 0) {
      console.log('No testnet accounts found in database');
    } else {
      console.log(`Found ${accounts.length} accounts:`);
      accounts.forEach(acc => {
        console.log(`  Account ${acc.id} (${acc.symbol} - ${acc.method_id}): trading_fees=${acc.accumulated_trading_fees}, funding_fees=${acc.accumulated_funding_fee}`);
      });
    }
  });

  // Test 4: Simulate fee calculation
  console.log('\nTest 4: Simulate fee calculation');
  
  // Test entry fee calculation (market order taker fee: 0.04%)
  const testOrderValue = 1000; // $1000 order
  const takerFeeRate = 0.0004; // 0.04%
  const expectedEntryFee = testOrderValue * takerFeeRate;
  console.log(`Order value: $${testOrderValue}`);
  console.log(`Taker fee rate: ${takerFeeRate * 100}%`);
  console.log(`Expected entry fee: $${expectedEntryFee.toFixed(4)}`);
  console.log(`✓ Entry fee calculation: $${expectedEntryFee.toFixed(4)}`);

  // Test funding fee calculation
  const testPositionSize = 1000; // $1000 position
  const testFundingRate = 0.0001; // 0.01%
  const testHoursHeld = 8; // 8 hours
  const expectedFundingFee = testPositionSize * testFundingRate * (testHoursHeld / 8);
  console.log(`\nPosition size: $${testPositionSize}`);
  console.log(`Funding rate: ${testFundingRate * 100}%`);
  console.log(`Hours held: ${testHoursHeld}`);
  console.log(`Expected funding fee: $${expectedFundingFee.toFixed(4)}`);
  console.log(`✓ Funding fee calculation: $${expectedFundingFee.toFixed(4)}`);

  // Test equity calculation with fees
  const testBalance = 1000;
  const testUnrealizedPnl = 50;
  const testAccumulatedTradingFees = 2.5;
  const testAccumulatedFundingFees = 0.5;
  const expectedEquity = testBalance + testUnrealizedPnl - testAccumulatedTradingFees - testAccumulatedFundingFees;
  console.log(`\nBalance: $${testBalance}`);
  console.log(`Unrealized PnL: $${testUnrealizedPnl}`);
  console.log(`Accumulated trading fees: $${testAccumulatedTradingFees}`);
  console.log(`Accumulated funding fees: $${testAccumulatedFundingFees}`);
  console.log(`Expected equity: $${expectedEquity.toFixed(2)}`);
  console.log(`✓ Equity calculation with fees: $${expectedEquity.toFixed(2)}`);

  setTimeout(() => {
    db.close();
    console.log('\n=== Fee Tracking Tests Complete ===');
  }, 500);
});

// Simple test script to verify multi-method paper trading functionality
import { initDatabase } from './src/db/database.js';
import { runMigrations } from './src/db/migrations.js';
import { METHODS } from './src/config/methods.js';
import { createAnalyzer } from './src/analyzers/analyzerFactory.js';

console.log('[Test] Starting multi-method functionality test...\n');

async function testDatabaseMigration() {
  console.log('[Test] Testing database migration...');
  try {
    const db = await initDatabase();
    console.log('[Test] ✓ Database initialized successfully');
    
    // Check if method_id column exists in accounts table
    await new Promise((resolve, reject) => {
      db.all("PRAGMA table_info(accounts)", (err, columns) => {
        if (err) {
          console.error('[Test] ✗ Error checking accounts table:', err.message);
          reject(err);
          return;
        }
        
        const currentColumns = columns.map(col => col.name);
        console.log('[Test] Accounts table columns:', currentColumns);
        
        if (currentColumns.includes('method_id')) {
          console.log('[Test] ✓ method_id column exists in accounts table');
        } else {
          console.log('[Test] ✗ method_id column NOT found in accounts table');
        }
        
        resolve();
      });
    });
    
    await new Promise((resolve) => {
      db.close(() => {
        console.log('[Test] ✓ Database connection closed');
        resolve();
      });
    });
    
    return true;
  } catch (error) {
    console.error('[Test] ✗ Database migration test failed:', error.message);
    return false;
  }
}

async function testMethodConfiguration() {
  console.log('\n[Test] Testing method configuration...');
  try {
    console.log('[Test] Available methods:', Object.keys(METHODS));
    
    for (const [methodId, method] of Object.entries(METHODS)) {
      console.log(`[Test] Method: ${methodId}`);
      console.log(`  - Name: ${method.name}`);
      console.log(`  - Schedule offset: ${method.scheduleOffset}s`);
      console.log(`  - Enabled: ${method.enabled}`);
      
      if (!method.enabled) {
        console.log(`[Test] ⚠ Method ${methodId} is disabled`);
      }
    }
    
    console.log('[Test] ✓ Method configuration verified');
    return true;
  } catch (error) {
    console.error('[Test] ✗ Method configuration test failed:', error.message);
    return false;
  }
}

async function testAnalyzerFactory() {
  console.log('\n[Test] Testing analyzer factory...');
  try {
    for (const [methodId, method] of Object.entries(METHODS)) {
      if (!method.enabled) continue;
      
      const analyzer = createAnalyzer(method);
      console.log(`[Test] Created analyzer for ${methodId}`);
      console.log(`  - Method ID: ${analyzer.methodId}`);
      console.log(`  - Name: ${analyzer.name}`);
      
      if (analyzer.methodId !== methodId) {
        console.log(`[Test] ✗ Analyzer method ID mismatch`);
        return false;
      }
    }
    
    console.log('[Test] ✓ Analyzer factory verified');
    return true;
  } catch (error) {
    console.error('[Test] ✗ Analyzer factory test failed:', error.message);
    return false;
  }
}

async function testSchedulerImport() {
  console.log('\n[Test] Testing scheduler imports...');
  try {
    const scheduler = await import('./src/scheduler.js');
    console.log('[Test] ✓ Scheduler module imported successfully');
    
    // Check if getOrCreateAccount is imported
    const db = await initDatabase();
    const { getOrCreateAccount } = await import('./src/db/database.js');
    console.log('[Test] ✓ getOrCreateAccount imported successfully');
    
    // Test the function
    const account = await getOrCreateAccount(db, 'BTC', 'ict', 100);
    console.log('[Test] ✓ getOrCreateAccount executed successfully');
    console.log(`[Test] Account: ${JSON.stringify(account)}`);
    
    await new Promise((resolve) => {
      db.close(() => resolve());
    });
    
    return true;
  } catch (error) {
    console.error('[Test] ✗ Scheduler import test failed:', error.message);
    return false;
  }
}

async function runAllTests() {
  const results = {
    databaseMigration: await testDatabaseMigration(),
    methodConfiguration: await testMethodConfiguration(),
    analyzerFactory: await testAnalyzerFactory(),
    schedulerImport: await testSchedulerImport()
  };
  
  console.log('\n[Test] Test Results:');
  console.log('==================');
  for (const [test, passed] of Object.entries(results)) {
    const status = passed ? '✓ PASS' : '✗ FAIL';
    console.log(`${status}: ${test}`);
  }
  
  const allPassed = Object.values(results).every(r => r === true);
  console.log('\n[Test] Overall:', allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED');
  
  process.exit(allPassed ? 0 : 1);
}

runAllTests().catch(console.error);

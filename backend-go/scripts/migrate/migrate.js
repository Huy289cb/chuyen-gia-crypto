/**
 * Master Migration Orchestration Script
 * 
 * This script orchestrates the entire data migration process from SQLite to PostgreSQL.
 * It runs all migration steps in sequence:
 * 1. Pre-migration validation
 * 2. Data export (SQLite → CSV)
 * 3. Data transformation (CSV → Transformed CSV)
 * 4. Data import (Transformed CSV → PostgreSQL)
 * 5. Post-migration validation
 * 
 * Usage: node scripts/migrate/migrate.js
 * 
 * Environment variables required:
 * - POSTGRES_HOST
 * - POSTGRES_PORT
 * - POSTGRES_USER
 * - POSTGRES_PASSWORD
 * - POSTGRES_DATABASE
 * 
 * Options:
 * --skip-validation: Skip pre/post validation (not recommended)
 * --export-only: Only export data, don't import
 * --import-only: Only import data (requires export to be done first)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const skipValidation = args.includes('--skip-validation');
const exportOnly = args.includes('--export-only');
const importOnly = args.includes('--import-only');

function logStep(step, message) {
  console.log('\n' + '='.repeat(60));
  console.log(`STEP ${step}: ${message}`);
  console.log('='.repeat(60));
}

async function runScript(scriptPath) {
  try {
    const { stdout, stderr } = await execAsync(`node ${scriptPath}`, {
      cwd: __dirname,
      env: process.env
    });
    console.log(stdout);
    if (stderr) console.error(stderr);
    return true;
  } catch (err) {
    console.error(`Script failed: ${scriptPath}`);
    console.error(err.message);
    return false;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('DATA MIGRATION ORCHESTRATION');
  console.log('SQLite → PostgreSQL');
  console.log('='.repeat(60));
  console.log(`Skip validation: ${skipValidation}`);
  console.log(`Export only: ${exportOnly}`);
  console.log(`Import only: ${importOnly}`);
  console.log('');

  // Check environment variables
  if (!exportOnly) {
    const requiredEnvVars = ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DATABASE'];
    const missing = requiredEnvVars.filter(v => !process.env[v]);
    if (missing.length > 0) {
      console.error('Missing required environment variables:');
      missing.forEach(v => console.error(`  - ${v}`));
      console.error('\nPlease set these environment variables before running migration.');
      process.exit(1);
    }
  }

  let success = true;

  // Step 1: Pre-migration validation
  if (!skipValidation && !importOnly) {
    logStep(1, 'Pre-migration validation');
    success = await runScript('./pre-migration-validation.js');
    if (!success) {
      console.error('\n❌ Pre-migration validation failed. Aborting migration.');
      process.exit(1);
    }
  } else {
    console.log('Skipping pre-migration validation');
  }

  // Step 2: Data export
  if (!importOnly) {
    logStep(2, 'Data export (SQLite → CSV)');
    success = await runScript('./export-data.js');
    if (!success) {
      console.error('\n❌ Data export failed. Aborting migration.');
      process.exit(1);
    }
  } else {
    console.log('Skipping data export (import-only mode)');
  }

  if (exportOnly) {
    console.log('\n✓ Export completed successfully (export-only mode)');
    process.exit(0);
  }

  // Step 3: Data transformation
  if (!importOnly) {
    logStep(3, 'Data transformation (CSV → Transformed CSV)');
    success = await runScript('./transform-data.js');
    if (!success) {
      console.error('\n❌ Data transformation failed. Aborting migration.');
      process.exit(1);
    }
  } else {
    console.log('Skipping data transformation (import-only mode)');
  }

  // Step 4: Data import
  logStep(4, 'Data import (Transformed CSV → PostgreSQL)');
  success = await runScript('./import-data.js');
  if (!success) {
    console.error('\n❌ Data import failed. Aborting migration.');
    process.exit(1);
  }

  // Step 5: Post-migration validation
  if (!skipValidation) {
    logStep(5, 'Post-migration validation');
    success = await runScript('./post-migration-validation.js');
    if (!success) {
      console.error('\n❌ Post-migration validation failed.');
      console.error('Please review the validation output and fix any issues.');
      process.exit(1);
    }
  } else {
    console.log('Skipping post-migration validation');
  }

  // Success
  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION COMPLETED SUCCESSFULLY');
  console.log('='.repeat(60));
  console.log('\nNext steps:');
  console.log('1. Verify the Go backend application works with PostgreSQL');
  console.log('2. Run parity tests between Node.js and Go versions');
  console.log('3. Monitor the system for any issues');
  console.log('4. Keep the Node.js version as rollback option until confident');
  console.log('');
  process.exit(0);
}

main().catch(err => {
  console.error('Migration orchestration failed:', err);
  process.exit(1);
});

#!/usr/bin/env node

/**
 * Script to ensure data directory exists and has proper permissions
 * Run this before starting the application on VPS
 */

import { mkdir, access, constants } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../..');
const DATA_DIR = join(PROJECT_ROOT, 'data');

async function ensureDataDirectory() {
  console.log('=== Data Directory Setup ===');
  console.log('Project root:', PROJECT_ROOT);
  console.log('Data directory:', DATA_DIR);
  
  try {
    // Check if directory already exists
    await access(DATA_DIR, constants.F_OK);
    console.log('✓ Data directory already exists');
    
    // Check write permissions
    await access(DATA_DIR, constants.W_OK);
    console.log('✓ Data directory is writable');
    
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('Creating data directory...');
      try {
        await mkdir(DATA_DIR, { recursive: true });
        console.log('✓ Data directory created successfully');
      } catch (mkdirError) {
        console.error('✗ Failed to create data directory:', mkdirError.message);
        process.exit(1);
      }
    } else if (error.code === 'EACCES') {
      console.error('✗ No write permission to data directory');
      console.error('Try running: chmod 755', dirname(DATA_DIR));
      console.error('Or run this script with sudo');
      process.exit(1);
    } else {
      console.error('✗ Error checking data directory:', error.message);
      process.exit(1);
    }
  }
  
  // Test creating a file in data directory
  try {
    const testFile = join(DATA_DIR, '.test');
    await import('fs').then(fs => 
      fs.promises.writeFile(testFile, 'test')
    );
    await import('fs').then(fs => 
      fs.promises.unlink(testFile)
    );
    console.log('✓ Write test passed');
  } catch (error) {
    console.error('✗ Write test failed:', error.message);
    process.exit(1);
  }
  
  console.log('\n=== Setup Complete ===');
  console.log('Data directory is ready for database operations');
}

ensureDataDirectory().catch(error => {
  console.error('Setup failed:', error);
  process.exit(1);
});

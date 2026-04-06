import { initDatabase } from './database.js';

async function main() {
  console.log('[DB Init] Initializing database...');
  try {
    const db = await initDatabase();
    console.log('[DB Init] Database initialized successfully');
    process.exit(0);
  } catch (error) {
    console.error('[DB Init] Failed to initialize database:', error);
    process.exit(1);
  }
}

main();

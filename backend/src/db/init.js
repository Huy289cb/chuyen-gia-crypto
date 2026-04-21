import { initDatabase } from './database.js';
import { runMigrations } from './migrations.js';
import { runSchemaValidationOnStartup } from './schemaValidator.js';

async function main() {
  console.log('[DB Init] Initializing database...');
  try {
    const db = await initDatabase();
    console.log('[DB Init] Running paper trading migrations...');
    await runMigrations(db);
    console.log('[DB Init] Running schema validation...');
    await runSchemaValidationOnStartup(db);
    console.log('[DB Init] Database initialized successfully with paper trading tables');
    process.exit(0);
  } catch (error) {
    console.error('[DB Init] Failed to initialize database:', error);
    process.exit(1);
  }
}

main();

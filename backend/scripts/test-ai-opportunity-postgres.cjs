// Creates and drops ONLY a uniquely named test database in the local Postgres container.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const parsed = require('dotenv').parse(fs.readFileSync(path.join(root, '.env')));
const source = new URL(parsed.DATABASE_URL);
const name = `crypto_ai_review_test_${Date.now()}`;
const user = decodeURIComponent(source.username);
if (!/^[a-zA-Z0-9_]+$/.test(user)) throw Error('Invalid local test role');
const test = new URL(source); test.pathname = '/' + name; test.searchParams.set('connection_limit', '4');
const out = path.resolve(root, '../docs/audits/2026-09-11-ai-opportunity-implementation');
fs.mkdirSync(out, { recursive: true });
const logfile = fs.openSync(path.join(out, 'postgres-tests.log'), 'w', 0o600);
const env = { ...process.env, DATABASE_URL: test.toString(), AI_OPPORTUNITY_TEST_DATABASE_URL: test.toString(),
  NODE_ENV: 'test', PRISMA_CONNECTION_LIMIT: '4', BINANCE_ENABLED: 'false', TELEGRAM_ENABLED: 'false' };
function run(cmd, args, testEnv = env) {
  const result = spawnSync(cmd, args, { cwd: root, env: testEnv, stdio: ['ignore', logfile, logfile], timeout: 120000 });
  if (result.error || result.status !== 0) throw Error(`Test subprocess failed: ${cmd} (see sanitized test log)`);
}
let created = false;
try {
  run('docker', ['exec', 'chuyen-gia-postgres', 'psql', '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${name}`]);
  created = true;
  run(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate']);
  run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/integration/ai-opportunity-postgres.test.ts', '--maxWorkers=1', '--minWorkers=1']);
  console.log('PASS: real PostgreSQL concurrency/quota/one-shot execution in isolated database');
} finally {
  if (created) run('docker', ['exec', 'chuyen-gia-postgres', 'psql', '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE ${name} WITH (FORCE)`]);
  fs.closeSync(logfile);
}

/**
 * PM2 Ecosystem Configuration
 *
 * Deploy layout:
 * - `.env` lives in `./backend` (same folder as this file).
 * - Built entrypoints run from `./backend/dist` (`server.js`, `worker.js`).
 * - Logs are written under `./backend/logs` (not inside `dist`).
 *
 * All runtime variables (API_ONLY, WORKER_ONLY, PORT, DATABASE_URL, cron tuning, …)
 * come from `backend/.env` via `env_file`. Use `API_ONLY=false` and `WORKER_ONLY=false`
 * when both apps share that file.
 *
 * Memory limits (1 vCPU / 1 GB RAM VPS): API 300M, worker 350M.
 */
const path = require('path');

const backendRoot = __dirname;
const distDir = path.join(backendRoot, 'dist');
const envPath = path.join(backendRoot, '.env');
const logsDir = path.join(backendRoot, 'logs');

require('dotenv').config({ path: envPath });

module.exports = {
  apps: [
    {
      name: 'crypto-api',
      cwd: distDir,
      script: path.join(distDir, 'server.js'),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env_file: envPath,
      error_file: path.join(logsDir, 'api-error.log'),
      out_file: path.join(logsDir, 'api-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true,
    },
    {
      name: 'crypto-worker',
      cwd: distDir,
      script: path.join(distDir, 'worker.js'),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '350M',
      env_file: envPath,
      error_file: path.join(logsDir, 'worker-error.log'),
      out_file: path.join(logsDir, 'worker-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true,
    },
  ],
};

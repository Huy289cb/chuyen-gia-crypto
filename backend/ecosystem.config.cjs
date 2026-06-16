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

require('dotenv').config({ path: envPath, override: true });

/** PM2 env_file misparses values starting with `-` (group chat_id). Inject via env. */
const telegramEnv = {
  TELEGRAM_ENABLED: process.env.TELEGRAM_ENABLED,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_IDS: process.env.TELEGRAM_CHAT_IDS,
  TELEGRAM_ALLOWED_USER_IDS: process.env.TELEGRAM_ALLOWED_USER_IDS,
  TELEGRAM_NOTIFY_LEVEL: process.env.TELEGRAM_NOTIFY_LEVEL,
  TELEGRAM_DAILY_REPORT_CRON: process.env.TELEGRAM_DAILY_REPORT_CRON,
  TELEGRAM_POLLING_ENABLED: process.env.TELEGRAM_POLLING_ENABLED,
  TELEGRAM_AI_ENABLED: process.env.TELEGRAM_AI_ENABLED,
  TELEGRAM_AI_MODEL: process.env.TELEGRAM_AI_MODEL,
  TELEGRAM_AI_MAX_TOKENS: process.env.TELEGRAM_AI_MAX_TOKENS,
  TELEGRAM_AI_RATE_LIMIT_PER_USER_HOUR: process.env.TELEGRAM_AI_RATE_LIMIT_PER_USER_HOUR,
  TELEGRAM_AI_RATE_LIMIT_PER_CHAT_DAY: process.env.TELEGRAM_AI_RATE_LIMIT_PER_CHAT_DAY,
  TELEGRAM_AI_SYSTEM_PROMPT_VERSION: process.env.TELEGRAM_AI_SYSTEM_PROMPT_VERSION,
  CURSOR_AGENT_ENABLED: process.env.CURSOR_AGENT_ENABLED,
  CURSOR_API_KEY: process.env.CURSOR_API_KEY,
  CURSOR_AGENT_MODEL: process.env.CURSOR_AGENT_MODEL,
  CURSOR_AGENT_REPO_URL: process.env.CURSOR_AGENT_REPO_URL,
  CURSOR_AGENT_BASE_BRANCH: process.env.CURSOR_AGENT_BASE_BRANCH,
  CURSOR_CHAT_ENABLED: process.env.CURSOR_CHAT_ENABLED,
  CURSOR_CHAT_MODEL: process.env.CURSOR_CHAT_MODEL,
  CURSOR_CHAT_ADMIN_ONLY: process.env.CURSOR_CHAT_ADMIN_ONLY,
  CURSOR_CHAT_RATE_LIMIT_PER_USER_HOUR: process.env.CURSOR_CHAT_RATE_LIMIT_PER_USER_HOUR,
  CURSOR_CHAT_SESSION_TTL_MS: process.env.CURSOR_CHAT_SESSION_TTL_MS,
  CURSOR_CHAT_JOB_TIMEOUT_MS: process.env.CURSOR_CHAT_JOB_TIMEOUT_MS,
};

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
      env: telegramEnv,
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
      env: telegramEnv,
      error_file: path.join(logsDir, 'worker-error.log'),
      out_file: path.join(logsDir, 'worker-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true,
    },
  ],
};

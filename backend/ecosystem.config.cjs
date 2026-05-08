/**
 * PM2 Ecosystem Configuration
 * 
 * This file defines the two-process architecture for production:
 * - crypto-api: HTTP API server (serves endpoints)
 * - crypto-worker: Background worker (scheduler, price sync, testnet sync)
 * 
 * Memory limits are set for 1 vCPU / 1 GB RAM VPS:
 * - API: 300M max memory
 * - Worker: 350M max memory
 */

module.exports = {
  apps: [
    {
      name: 'crypto-api',
      script: './dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env_file: '.env',
      env: {
        NODE_ENV: 'production',
        API_ONLY: 'true',
        WORKER_ONLY: 'false',
        PORT: 3000,
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true,
    },
    {
      name: 'crypto-worker',
      script: './dist/worker.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '350M',
      env_file: '.env',
      env: {
        NODE_ENV: 'production',
        API_ONLY: 'false',
        WORKER_ONLY: 'true',
      },
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true,
    },
  ],
};

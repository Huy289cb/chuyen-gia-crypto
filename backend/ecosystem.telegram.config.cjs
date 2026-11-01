const path = require('path');
const fileEnv = require('dotenv').config({ path: path.join(__dirname, '.env') }).parsed || {};

module.exports = {
  apps: [{
    name: 'crypto-telegram-bot',
    cwd: __dirname,
    script: path.join(__dirname, 'dist/portfolio/hybrid-telegram-worker.js'),
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    kill_timeout: 10000,
    env: {
      ...fileEnv,
      PORTFOLIO_LIVE_POLICY: 'PHASE2_HYBRID_MOM50_BTCGRID45_SL12_V1',
    },
    error_file: path.join(__dirname, 'logs/telegram-bot-error.log'),
    out_file: path.join(__dirname, 'logs/telegram-bot-out.log'),
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    time: true,
  }],
};

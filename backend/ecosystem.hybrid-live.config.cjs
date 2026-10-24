const path = require('path');
const fileEnv = require('dotenv').config({ path: path.join(__dirname, '.env') }).parsed || {};

module.exports = {
  apps: [{
    name: 'crypto-hybrid-live',
    cwd: __dirname,
    script: path.join(__dirname, 'dist/portfolio/hybrid-worker.js'),
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    kill_timeout: 10000,
    env: {
      ...fileEnv,
      PORTFOLIO_EXECUTION_OWNER: 'PHASE2_HYBRID_MOM50_BTCGRID45_SL12_V1',
      PORTFOLIO_LIVE_POLICY: 'PHASE2_HYBRID_MOM50_BTCGRID45_SL12_V1',
      PORTFOLIO_LIVE_INITIAL_CASH: '100',
      PORTFOLIO_LIVE_DAILY_LOSS_LIMIT: '12',
    },
    error_file: path.join(__dirname, 'logs/hybrid-live-error.log'),
    out_file: path.join(__dirname, 'logs/hybrid-live-out.log'),
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    time: true,
  }],
};

const path = require('path');
const fileEnv = require('dotenv').config({ path: path.join(__dirname, '.env') }).parsed || {};
module.exports = { apps: [{
  name: 'crypto-portfolio-live', cwd: __dirname,
  script: path.join(__dirname, 'dist/portfolio/live-worker.js'),
  instances: 1, exec_mode: 'fork', autorestart: true, watch: false,
  max_memory_restart: '160M', kill_timeout: 10000,
  env: { ...fileEnv, PORTFOLIO_EXECUTION_OWNER: 'CONSTANT_DIRECTION_B5_S6_DAILY15_V1' },
  error_file: path.join(__dirname, 'logs/portfolio-live-error.log'),
  out_file: path.join(__dirname, 'logs/portfolio-live-out.log'),
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z', merge_logs: true, time: true,
}] };

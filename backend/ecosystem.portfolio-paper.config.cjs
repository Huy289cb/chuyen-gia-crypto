const path = require('node:path');
// No.env and no private trading credentials needed by this worker.
module.exports = { apps: [{
  name: 'crypto-portfolio-paper', cwd: __dirname,
  script: path.join(__dirname, 'dist/portfolio/paper-worker.js'),
  instances: 1, exec_mode: 'fork', autorestart: true, watch: false,
  max_memory_restart: '180M', node_args: '--max-old-space-size=128',
  env: { NODE_ENV: 'production', PORTFOLIO_PAPER_ENABLED: 'true' },
  error_file: path.join(__dirname, 'logs/portfolio-paper-error.log'),
  out_file: path.join(__dirname, 'logs/portfolio-paper-out.log'),
  time: true,
}] };

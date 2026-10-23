// Independent observer: only market/DB reads and research-file writes.
const path = require('path');
const runtimeEnv = require('./ecosystem.config.cjs').apps[0].env;
module.exports = { apps: [{
  name: 'crypto-post-exit', cwd: __dirname,
  script: path.join(__dirname, 'dist/post-exit-observer.js'),
  instances: 1, exec_mode: 'fork', autorestart: true, watch: false,
  max_memory_restart: '120M', node_args: '--max-old-space-size=96',
  env: { ...runtimeEnv, PRISMA_CONNECTION_LIMIT: '1' },
  out_file: path.join(__dirname, 'logs/post-exit-out.log'),
  error_file: path.join(__dirname, 'logs/post-exit-error.log'),
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z', time: true,
}] };

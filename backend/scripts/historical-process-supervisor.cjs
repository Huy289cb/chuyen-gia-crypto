'use strict';
const fs = require('node:fs');
const cp = require('node:child_process');

// Keep a terminal interrupt of the launcher from killing a replay mid-command.
// The replay owns command-boundary shutdown and economic terminal export.
function superviseHistoricalProcess({ executable, args, options, processFile, terminalFile }) {
  for (const file of [processFile, terminalFile]) {
    if (fs.existsSync(file)) throw Error('process_artifact_already_exists');
  }
  const child = cp.spawn(executable, args, { ...options, detached: true });
  const startedAt = Date.now();
  let stopRequested = null;
  const requestStop = signal => {
    if (stopRequested) return;
    stopRequested = { signal, requested_at: Date.now(), forwarded_signal: 'SIGTERM' };
    fs.writeFileSync(processFile, JSON.stringify({ pid: child.pid, started_at: startedAt,
      status: 'stop_requested_not_terminal', stop_requested: stopRequested }, null, 2), { mode: 0o600 });
    child.kill('SIGTERM');
  };
  const onInt = () => requestStop('SIGINT');
  const onTerm = () => requestStop('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  fs.writeFileSync(processFile, JSON.stringify({ pid: child.pid, started_at: startedAt,
    status: 'spawned_not_completion_evidence', separate_process_group: true }, null, 2),
    { flag: 'wx', mode: 0o600 });
  const completion = new Promise(resolve => {
    let spawnError = null;
    child.on('error', error => { spawnError = { code: error.code ?? null, message: error.message }; });
    child.on('close', (code, signal) => {
      process.removeListener('SIGINT', onInt);
      process.removeListener('SIGTERM', onTerm);
      const terminal = { pid: child.pid, exit_code: code, signal, spawn_error: spawnError,
        started_at: startedAt, ended_at: Date.now(), stop_requested: stopRequested,
        scope: 'process lifecycle only; result.json and journal integrity required for economics' };
      fs.writeFileSync(terminalFile, JSON.stringify(terminal, null, 2), { flag: 'wx', mode: 0o600 });
      resolve(terminal);
    });
  });
  return { child, completion };
}
module.exports = { superviseHistoricalProcess };

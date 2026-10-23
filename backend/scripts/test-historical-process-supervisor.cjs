'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const { superviseHistoricalProcess } = require('./historical-process-supervisor.cjs');

function artifacts(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'historical-supervision-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, processFile: path.join(dir, 'process.json'), terminalFile: path.join(dir, 'terminal.json') };
}
test('terminal SIGINT reaches replay as SIGTERM and preserves command-boundary export', { timeout: 5000 }, async t => {
  const a = artifacts(t), marker = path.join(a.dir, 'shutdown.json');
  const supervised = superviseHistoricalProcess({ ...a, executable: process.execPath,
    args: ['-e', `process.on('SIGTERM',()=>{require('fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({signal:'SIGTERM',boundary_saved:true}));process.exit(0)});console.log('ready');setInterval(()=>{},1000);`],
    options: { stdio: ['ignore', 'pipe', 'pipe'] } });
  t.after(() => { if (supervised.child.exitCode === null) supervised.child.kill('SIGKILL'); });
  await new Promise(resolve => supervised.child.stdout.once('data', resolve));
  const pgid = Number(cp.execFileSync('ps', ['-o', 'pgid=', '-p', String(supervised.child.pid)], { encoding: 'utf8' }).trim());
  assert.equal(pgid, supervised.child.pid);
  process.kill(process.pid, 'SIGINT');
  const terminal = await supervised.completion;
  assert.equal(terminal.exit_code, 0);
  assert.equal(terminal.stop_requested.signal, 'SIGINT');
  assert.equal(terminal.stop_requested.forwarded_signal, 'SIGTERM');
  assert.deepEqual(JSON.parse(fs.readFileSync(marker)), { signal: 'SIGTERM', boundary_saved: true });
  assert.equal(JSON.parse(fs.readFileSync(a.terminalFile)).scope.includes('journal integrity required'), true);
});
test('abrupt child SIGKILL is recorded as failure without manufacturing result.json', { timeout: 5000 }, async t => {
  const a = artifacts(t);
  const supervised = superviseHistoricalProcess({ ...a, executable: process.execPath,
    args: ['-e', 'console.log("ready");setInterval(()=>{},1000)'], options: { stdio: ['ignore', 'pipe', 'pipe'] } });
  await new Promise(resolve => supervised.child.stdout.once('data', resolve));
  supervised.child.kill('SIGKILL');
  const terminal = await supervised.completion;
  assert.equal(terminal.signal, 'SIGKILL');
  assert.equal(terminal.exit_code, null);
  assert.equal(fs.existsSync(path.join(a.dir, 'result.json')), false);
});
test('existing registration cannot spawn a replacement child', t => {
  const a = artifacts(t); fs.writeFileSync(a.processFile, '{}');
  assert.throws(() => superviseHistoricalProcess({ ...a, executable: process.execPath, args: [] }), /process_artifact_already_exists/);
});

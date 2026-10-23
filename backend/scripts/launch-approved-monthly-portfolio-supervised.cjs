'use strict';
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const {superviseHistoricalProcess}=require('./historical-process-supervisor.cjs');
const arm=process.argv[2];if(!['baseline','candidate'].includes(arm))throw Error('registered_arm_required');
const c=JSON.parse(cp.execFileSync('docker',['inspect','roi-close-atomic-test-20261003'],{encoding:'utf8'}))[0];
const e=Object.fromEntries(c.Config.Env.map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)]}));
if(c.NetworkSettings.Ports['5432/tcp'][0].HostPort!=='55439'||c.NetworkSettings.Ports['5432/tcp'][0].HostIp!=='127.0.0.1')throw Error('isolated_only');
const url=`postgresql://${encodeURIComponent(e.POSTGRES_USER)}:${encodeURIComponent(e.POSTGRES_PASSWORD)}@127.0.0.1:55439/crypto_reset_test`,audit=process.argv[3]??'docs/audits/2026-10-07-approved-monthly-portfolio';
// Requires a separately registered fresh output directory; existing process/log files reject restart.
const log=fs.openSync(path.join(audit,arm+'-run.log'),'wx',0o600);
const supervised=superviseHistoricalProcess({executable:process.execPath,args:['backend/scripts/run-causal-range-scheduler-integration-sql.cjs',audit+'/'+arm+'-run','2025-02-01T00:00:05Z','2025-03-01T00:00:05Z','hybrid','docs/audits/2026-10-07-matched-causal-portfolio/provider-receipts.json','docs/audits/2026-10-07-h2-permission-boundary/workflow-schema-probe/runtime','docs/audits/2026-10-07-matched-causal-portfolio/policy.json','checkpoints',audit+'/'+arm+'-experiment.json'],options:{env:{...process.env,ROI_ATOMIC_TEST_DATABASE_URL:url},stdio:['ignore',log,log]},processFile:path.join(audit,arm+'-process.json'),terminalFile:path.join(audit,arm+'-process-terminal.json')});
fs.closeSync(log);
console.log(JSON.stringify({arm,pid:supervised.child.pid}));
supervised.completion.then(terminal=>{console.log(JSON.stringify({arm,...terminal}));process.exitCode=terminal.exit_code??1;});

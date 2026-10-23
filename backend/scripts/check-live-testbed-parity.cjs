// Fail closed before describing an archived testbed as the current live version.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
function compare(protocol,runtime){
 const files=[...new Set([...Object.keys(protocol.hashes),...Object.keys(runtime.hashes)])];
 const changedFiles=files.filter(f=>protocol.hashes[f]!==runtime.hashes[f]);
 const keys=[...new Set([...Object.keys(protocol.policyEnv),...Object.keys(runtime.policyEnv)])];
 const changedPolicy=keys.filter(k=>protocol.policyEnv[k]!==runtime.policyEnv[k]).map(key=>({key,archived:protocol.policyEnv[key]??null,current:runtime.policyEnv[key]??null}));
 return {matches:!changedFiles.length&&!changedPolicy.length,changedFiles,changedPolicy};
}
module.exports={compare};
if(require.main===module){
 const file=process.argv[2];if(!file)throw Error('protocol_path_required');
 const protocol=JSON.parse(fs.readFileSync(file)),apps=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8'}));
 const app=apps.find(a=>a.name==='crypto-worker');if(!app?.pid)throw Error('worker_unavailable');
 const root=path.dirname(app.pm2_env.pm_exec_path),hashes={};
 function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith('.js'))hashes[path.relative(root,p)]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}}walk(root);
 const env=Object.fromEntries(fs.readFileSync('/proc/'+app.pid+'/environ','utf8').split('\0').filter(Boolean).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));
 // Match the original collector's explicit non-secret policy selection.
 const policyEnv=Object.fromEntries(Object.entries(env).filter(([k])=>/^(V3_|TRANSITION_|RANGE_|ADAPTIVE_|FUNDING_|CLOSED_|MIN_|MAX_|RISK_|DAILY_|POST_|LOSS_|CONSECUTIVE_|CIRCUIT_|PROFIT_|INVALIDATION_|SIGNAL_GATE_|PENDING_ORDER_|GROQ_.*MODEL|OPENROUTER_.*MODEL|CEREBRAS_.*MODEL|LLM_)/.test(k)&&!/KEY|TOKEN|SECRET|PASSWORD|URL/.test(k)));
 const result=compare(protocol,{hashes,policyEnv});console.log(JSON.stringify(result,null,2));process.exitCode=result.matches?0:2;
}

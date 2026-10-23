// One-shot read-only capture and offline review. No orders, provider requests or policy writes.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function validateWindow(manifest,now){const since=Date.parse(manifest.since),end=Date.parse(manifest.review_at);if(!Number.isFinite(since)||!Number.isFinite(end)||end<=since||manifest.auto_extend!==false)throw Error('invalid_fixed_window');if(now<end)throw Error('review_not_due');return {since:new Date(since).toISOString(),through:new Date(end).toISOString()};}
module.exports={validateWindow};
if(require.main===module){
 const [manifestArg,outArg]=process.argv.slice(2),root=path.resolve(__dirname,'..');if(!manifestArg||!outArg)throw Error('MANIFEST NEW_OUTPUT_DIR');const manifestPath=path.resolve(manifestArg),out=path.resolve(outArg),manifest=JSON.parse(fs.readFileSync(manifestPath));const window=validateWindow(manifest,Date.now());fs.mkdirSync(out,{mode:0o700});
 const report={schema:'fixed-forward-cohort-review-v1',started_at:new Date().toISOString(),window,manifest_sha256:hash(fs.readFileSync(manifestPath)),steps:[],status:'running',economic_roi_base:null,economic_roi_stress:null,independent_fills:null,candidate_execution:'not_run_gates_incomplete',auto_extend:false};
 try{
  const apps=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8',timeout:10000})),worker=apps.find(a=>a.name==='crypto-worker');if(!worker?.pid||worker.pm2_env.status!=='online')throw Error('worker_not_online');
  const liveEnv=Object.fromEntries(fs.readFileSync('/proc/'+worker.pid+'/environ','utf8').split('\0').filter(Boolean).map(s=>{const n=s.indexOf('=');return [s.slice(0,n),s.slice(n+1)]}));
  const env={...process.env,...liveEnv};
  // Do not attach standalone collectors to an inherited PM2 IPC descriptor.
  for(const key of ['NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE','NODE_UNIQUE_ID'])delete env[key];
  const runtimeRoot=path.join(root,'dist');report.runtime_js_hashes=Object.fromEntries(fs.readdirSync(runtimeRoot,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()&&e.name.endsWith('.js')).map(e=>{const f=path.join(e.parentPath||e.path,e.name);return [path.relative(runtimeRoot,f),hash(fs.readFileSync(f))]}));
  report.policy=Object.fromEntries(['MAX_EFFECTIVE_RISK_PER_TRADE_PERCENT','DAILY_LOSS_LIMIT_PERCENT','MIN_SL_DISTANCE_PERCENT','RISK_PER_TRADE_PERCENT','MAX_TOTAL_EXPOSURE_USD','POST_CLOSE_SAME_SIDE_COOLDOWN_MINUTES'].map(k=>[k,env[k]??null]));
  report.baseline_policy_matches=Object.entries({MAX_EFFECTIVE_RISK_PER_TRADE_PERCENT:'3',DAILY_LOSS_LIMIT_PERCENT:'10',MIN_SL_DISTANCE_PERCENT:'0.008',RISK_PER_TRADE_PERCENT:'0.5',MAX_TOTAL_EXPOSURE_USD:'100',POST_CLOSE_SAME_SIDE_COOLDOWN_MINUTES:'60'}).every(([k,v])=>env[k]===v);
  function step(script,args,timeout=60000){const file=path.join(__dirname,script),result=cp.spawnSync(process.execPath,[file,...args],{cwd:root,env,encoding:'utf8',timeout,maxBuffer:1000000});report.steps.push({script,script_sha256:hash(fs.readFileSync(file)),exit_code:result.status,completed_at:new Date().toISOString(),execution_error:result.error?.code??null});if(result.status!==0)throw Error('step_failed:'+script);}
  const telemetry=path.join(out,'telemetry.json'),provider=path.join(out,'provider.json'),replay=path.join(out,'canonical.json'),seed=path.join(path.dirname(manifestPath),'forward-cohort-account-seed-v1.json');
  if(hash(fs.readFileSync(seed))!==manifest.initial_seed_sha256)throw Error('seed_hash_mismatch');
  step('capture-upgrade-telemetry.cjs',[window.since,telemetry,window.through]);step('capture-provider-journal.cjs',[window.since,provider,window.through]);step('run-canonical-portfolio-replay.cjs',[telemetry,replay,provider,seed]);
  const canonical=JSON.parse(fs.readFileSync(replay));report.summary={pre_ai_planning:canonical.pre_ai_planning,baseline_assessment:canonical.baseline_assessment,baseline_assessment_source_sha256:canonical.baseline_assessment_source_sha256,baseline_input_bundle:canonical.baseline_input_bundle,close_ledger_rows:canonical.observed_close_ledger?.rows.length??0,decision_state_checkpoints:canonical.portfolio_state_at_decisions?.checkpoints.length??0,eligible_events:canonical.eligible_events,traces:canonical.traces.length,gates:canonical.gates,missing_inputs:canonical.missing_inputs_and_integration,trace_composition_counts:Object.fromEntries(['partial','unknown','observed_read_subsequence'].map(s=>[s,canonical.trace_admission_composition.traces.filter(t=>t.status===s).length]))};
  const cashflow=path.join(out,'exchange-cashflow.json');
  try{
   step('capture-exchange-cashflows.cjs',[window.since,window.through,cashflow],30000);
   const evidence=JSON.parse(fs.readFileSync(cashflow));
   report.summary.exchange_cashflow={artifact:'exchange-cashflow.json',income_rows:evidence.income.length,endpoint_pagination_finished:evidence.endpoint_pagination_finished,observed_by_asset_and_type:evidence.observed_by_asset_and_type,account_snapshot_received_at:evidence.account_snapshot.received_at,terminal_equity_at_requested_cutoff:evidence.account_snapshot.terminal_equity_at_requested_cutoff,capital_flow_coverage:evidence.capital_flow_coverage,economic_roi:null};
   report.summary.equity_reconciliation=require('./assess-canonical-baseline.cjs').reconcileObservedEquity(JSON.parse(fs.readFileSync(seed)),evidence);
   report.exchange_cashflow_sha256=hash(fs.readFileSync(cashflow));
  }catch{report.summary.exchange_cashflow={status:'unknown',reason:'supplemental_GET_capture_failed_or_timed_out',economic_roi:null};}
  report.status='insufficient';report.reason='Full evolving state, economic ROI, independent fills and gates remain unproven; fixed window closed without extension.';
  report.artifact_hashes=Object.fromEntries(['telemetry.json','provider.json','canonical.json'].map(f=>[f,hash(fs.readFileSync(path.join(out,f)))]));
 }catch(error){report.status='failed';report.error_code=String(error.message).split('\n')[0].slice(0,160);process.exitCode=1;}
 finally{report.completed_at=new Date().toISOString();fs.writeFileSync(path.join(out,'review.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:report.status,report:path.join(out,'review.json')}));}
}

'use strict';
const moduleStartedAt=Date.now();
// Finite future registration only. Importing this module never starts a replay.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {superviseHistoricalProcess}=require('./historical-process-supervisor.cjs');
const {candidateNecessaryCondition}=require('./candidate-portfolio-necessary-condition.cjs');
const root=path.resolve(__dirname,'../..');
const order=['base_candidate','base_baseline','stress_candidate','stress_baseline'];
const runners={base:'backend/scripts/run-causal-range-scheduler-integration-shared-dataset-indexed-strict-db-phases.cjs',stress:'backend/scripts/run-causal-range-scheduler-integration-shared-dataset-indexed-strict-db-stress-phases.cjs'};
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const resolve=f=>path.isAbsolute(f)?f:path.join(root,f);
const finitePositive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const validCost=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const requireThat=(ok,reason)=>{if(!ok)throw Error(reason);};
function hashes(reg){
 requireThat(reg.source_hashes&&Object.keys(reg.source_hashes).length>0,'registered_source_hashes_required');
 const registered=new Map(Object.entries(reg.source_hashes).map(([f,h])=>[resolve(f),h]));
 for(const f of [path.relative(root,__filename),...Object.values(runners),'backend/scripts/prepare-empty-research-schema-offline.cjs','backend/scripts/prepare-structural-root-event-index.cjs','backend/scripts/historical-process-supervisor.cjs','backend/scripts/candidate-portfolio-necessary-condition.cjs'])requireThat(registered.has(resolve(f)),'required_source_hash_missing:'+f);
 for(const [f,h]of registered)requireThat(/^[a-f0-9]{64}$/.test(h)&&sha(f)===h,'registered_source_changed:'+path.basename(f));
 requireThat(sha(resolve(reg.policy_file))===reg.policy_sha256,'registered_policy_changed');
 requireThat(sha(resolve(reg.dataset.file))===reg.dataset.sha256,'registered_dataset_changed');
 requireThat(sha(resolve(reg.provider_receipts_file))===reg.provider_receipts_sha256,'registered_initial_receipts_changed');
 const current={};function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(e.name.endsWith('.js'))current[path.relative(resolve(reg.runtime_root),f)]=sha(f);}}walk(resolve(reg.runtime_root));
 requireThat(reg.runtime_js_hashes&&same(current,reg.runtime_js_hashes),'registered_runtime_tree_changed');
 return registered;
}
function validateRegistration(reg){
 requireThat(reg.version==='four-arm-shared-engine-portfolio-v1'&&reg.execution==='serial'&&reg.promotion_allowed===false,'finite_four_arm_registration_required');
 requireThat(typeof reg.authorization==='string'&&reg.authorization.trim(),'registered_authorization_required');
 requireThat(same(reg.arm_order,order)&&Array.isArray(reg.arms)&&reg.arms.length===4,'registered_four_arm_order_required');
 requireThat(Number.isFinite(Date.parse(reg.start))&&Number.isFinite(Date.parse(reg.end))&&Date.parse(reg.end)>Date.parse(reg.start)&&Date.parse(reg.end)-Date.parse(reg.start)<=31*86400000&&(Date.parse(reg.end)-Date.parse(reg.start))%60000===0,'registered_bounded_aligned_window_required');
 requireThat(reg.capital===31.47744546&&Number.isFinite(reg.warmup_start)&&reg.warmup_start<Date.parse(reg.start),'registered_runner_capital_and_warmup_required');
 requireThat(reg.provider_mode==='hybrid'&&finitePositive(reg.max_combined_new_reported_provider_cost_usd)&&reg.cleanup_seconds===120,'registered_provider_and_cleanup_budget_required');
 requireThat(reg.reject_nonviable_candidate_before_baseline===true,'candidate_necessary_condition_required');
 requireThat(reg.dataset&&typeof reg.dataset.file==='string','registered_dataset_required');
 const schemas=new Set();for(let i=0;i<order.length;i++){
  const a=reg.arms[i],[mode,arm]=order[i].split('_');
  requireThat(a.id===order[i]&&a.mode===mode&&a.arm===arm&&/^engine_[a-zA-Z0-9_]+$/.test(a.schema??'')&&a.schema.length<=63&&!schemas.has(a.schema),'registered_distinct_isolated_arm_required');schemas.add(a.schema);
  requireThat(Number.isInteger(a.max_wall_seconds)&&a.max_wall_seconds>20&&Number.isInteger(a.max_new_provider_calls)&&a.max_new_provider_calls>0&&finitePositive(a.max_new_reported_provider_cost_usd),'registered_finite_arm_budgets_required');
 }
 hashes(reg);
 const receipts=read(resolve(reg.provider_receipts_file));requireThat(Array.isArray(receipts),'registered_receipt_queue_required');
 for(const r of receipts)requireThat(r.body&&r.response&&Number.isInteger(r.status)&&Number.isFinite(r.at)&&validCost(r.response.usage?.cost),'initial_receipt_identity_or_cost_missing');
}
function checkTerminal({reg,a,result:r,manifest:m,terminal,registered,receiptSha,effectiveCostCap}){
 const d=r.diagnostics;
 requireThat(terminal.exit_code===0&&!terminal.signal&&!terminal.spawn_error&&r.status==='integration_window_completed'&&r.last_evaluated_at===Date.parse(reg.end)&&r.terminal_export_complete===true,'arm_incomplete_or_failed:'+a.id);
 requireThat(Array.isArray(r.terminal_command_gaps)&&!r.terminal_command_gaps.length&&d&&['database_errors','adapter_failures','unavailable_dependencies','provider_errors'].every(k=>Array.isArray(d[k])&&!d[k].length)&&!d.checkpoint_failure&&!d.database_boundary_failure,'arm_integrity_failed:'+a.id);
 requireThat(m.start===reg.start&&m.end===reg.end&&m.capital===reg.capital&&m.storage_schema===a.schema&&m.causal_experiment?.arm===a.arm&&m.causal_experiment?.prepared_schema===a.schema,'arm_registered_scope_mismatch:'+a.id);
 requireThat(m.causal_experiment.warmup_start===reg.warmup_start&&m.causal_experiment.max_wall_seconds===a.max_wall_seconds&&m.causal_experiment.max_provider_calls===a.max_new_provider_calls&&m.causal_experiment.max_reported_cost_usd===effectiveCostCap&&same(m.causal_experiment.hashes,reg.source_hashes),'arm_registered_experiment_mismatch:'+a.id);
 requireThat(same(m.environment,read(resolve(reg.policy_file)).environment)&&same(m.dataset,reg.dataset)&&same(m.runtime_js_hashes,reg.runtime_js_hashes)&&m.provider_receipts_sha256===receiptSha&&m.provider_mode==='exact_receipts_then_real_new_requests','arm_input_manifest_mismatch:'+a.id);
 requireThat(m.max_provider_calls===a.max_new_provider_calls&&m.max_new_reported_provider_cost_usd===effectiveCostCap,'arm_budget_manifest_mismatch:'+a.id);
 requireThat(m.execution_model?.fee_rate===.0005&&m.execution_model?.min_qty===.001&&m.execution_model?.step_size===.001&&m.execution_model?.min_notional===50,'arm_execution_contract_mismatch:'+a.id);
 requireThat(a.mode==='stress'?m.execution_model?.stress_version==='penetration-adverse-market-v1'&&m.execution_model.limit_penetration===.001&&m.execution_model.market_adverse_slippage===.001:!m.execution_model?.stress_version,'arm_execution_mode_mismatch:'+a.id);
 requireThat(m.source_hashes&&Object.keys(m.source_hashes).length>0,'arm_source_manifest_missing:'+a.id);
 for(const [f,h]of Object.entries(m.source_hashes))requireThat(registered.get(path.resolve(__dirname,f))===h,'arm_manifest_source_unregistered:'+f);
 requireThat(Array.isArray(r.network_receipts)&&Array.isArray(r.receipt_replays)&&r.provider_receipt_replay&&Array.isArray(r.provider_receipt_replay.used)&&r.provider_receipt_replay.used.length===r.receipt_replays.length&&r.provider_receipt_replay.source_sha256===receiptSha,'arm_receipt_coverage_mismatch:'+a.id);
 requireThat(!r.provider_cost_unknown&&!r.provider_budget_exceeded&&r.network_receipts.length<=a.max_new_provider_calls,'arm_provider_stop_or_budget_error:'+a.id);
 const newCosts=r.network_receipts.map(x=>x.response?.usage?.cost),reused=r.receipt_replays.map(x=>x.reported_cost);
 requireThat([...newCosts,...reused].every(validCost),'arm_unknown_operating_cost:'+a.id);
 const newCost=newCosts.reduce((s,c)=>s+c,0),reusedCost=reused.reduce((s,c)=>s+c,0);
 requireThat(validCost(r.new_reported_provider_cost_usd)&&Math.abs(newCost-r.new_reported_provider_cost_usd)<=1e-10&&newCost<=effectiveCostCap+1e-10,'arm_new_invoice_budget_or_sum_mismatch:'+a.id);
 return{new_reported_invoice_cost_usd:newCost,reused_operating_ai_cost_usd:reusedCost,operating_ai_cost_usd:newCost+reusedCost,new_requests:r.network_receipts.length,reused_requests:r.receipt_replays.length};
}
async function launch(registrationFile,auditDirectory){
 const launcherStartedAt=require.main===module?moduleStartedAt:Date.now();
 requireThat(typeof registrationFile==='string'&&typeof auditDirectory==='string','explicit_registration_and_audit_required');
 const reg=read(resolve(registrationFile)),audit=resolve(auditDirectory);validateRegistration(reg);
 requireThat(audit.startsWith(path.join(root,'docs/audits')+path.sep)&&path.resolve(audit)!==path.resolve(path.join(root,'docs/audits')),'registered_audit_scope_required');
 if(reg.audit_directory)requireThat(path.resolve(resolve(reg.audit_directory))===path.resolve(audit),'registered_audit_directory_mismatch');
 fs.mkdirSync(audit,{recursive:true,mode:0o700});requireThat(fs.realpathSync(audit).startsWith(path.join(root,'docs/audits')+path.sep),'audit_symlink_scope_escape');
 const write=(name,value)=>fs.writeFileSync(path.join(audit,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
 write('launch-start.json',{registration_file:registrationFile,registration_sha256:sha(resolve(registrationFile)),started_at:new Date().toISOString(),scope:'four serial shared-engine arms; no automatic promotion'});
 const receiptBytes=fs.readFileSync(resolve(reg.provider_receipts_file)),receiptSha=crypto.createHash('sha256').update(receiptBytes).digest('hex');
 const initial=path.join(audit,'initial-provider-receipts.json');fs.writeFileSync(initial,receiptBytes,{flag:'wx',mode:0o600});
 write('receipt-provenance.json',{source:reg.provider_receipts_file,source_sha256:receiptSha,staged_sha256:sha(initial),queue_order:'original byte order, identical initial queue for every arm',append_completed_phase_receipts:false,cost_rule:'charge original reported cost for every reused occurrence; new billing counted separately'});
 const report={version:reg.version,status:'starting',registration_sha256:sha(resolve(registrationFile)),arms:[],new_reported_provider_cost_usd:0,operating_ai_cost_usd:0,cost_totals_scope:'verified_completed_arms_only',all_attempts_cost_coverage:'pending',all_cost_roi_base:null,roi_stress:null,independent_quality_fill_uplift:null,economic_goal_proven:false,promotion_allowed:false};
 let activeArm=null;
 let stopSignal=null;const interrupted=signal=>{stopSignal??=signal;};const onInt=()=>interrupted('SIGINT'),onTerm=()=>interrupted('SIGTERM');process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);
 try{
  for(const a of reg.arms){
   requireThat(!stopSignal,'launcher_interrupted_before_arm');const armStarted=report.arms.length===0?launcherStartedAt:Date.now(),deadline=armStarted+a.max_wall_seconds*1000,deadlineUtc=new Date(deadline).toISOString();
   activeArm={id:a.id,mode:a.mode,arm:a.arm,schema:a.schema,started_at:new Date(armStarted).toISOString(),deadline_utc:deadlineUtc,stage:'source_and_input_preflight',run_directory:path.join(audit,a.id+'-run')};
   const registered=hashes(reg),remainingCombined=reg.max_combined_new_reported_provider_cost_usd-report.new_reported_provider_cost_usd,effectiveCostCap=Math.min(a.max_new_reported_provider_cost_usd,remainingCombined);
   requireThat(finitePositive(effectiveCostCap),'combined_new_provider_budget_exhausted');
   const out=path.join(audit,a.id+'-run'),bootstrapOut=path.join(audit,a.id+'-bootstrap'),receiptFile=path.join(audit,a.id+'-provider-receipts.json'),experimentFile=path.join(audit,a.id+'-experiment.json');
   requireThat(!fs.existsSync(out)&&!fs.existsSync(bootstrapOut),'new_arm_directories_required_no_restart');
   fs.writeFileSync(receiptFile,receiptBytes,{flag:'wx',mode:0o600});
   const experiment={arm:a.arm,warmup_start:reg.warmup_start,max_wall_seconds:a.max_wall_seconds,max_provider_calls:a.max_new_provider_calls,max_reported_cost_usd:effectiveCostCap,prepared_schema:a.schema,hashes:reg.source_hashes};
   fs.writeFileSync(experimentFile,JSON.stringify(experiment,null,2)+'\n',{flag:'wx',mode:0o600});
   write(a.id+'-arm-start.json',{started_at:new Date(armStarted).toISOString(),deadline_utc:deadlineUtc,bootstrap_included_in_wall:true,effective_new_reported_cost_cap:effectiveCostCap,receipt_sha256:receiptSha});
   // Dynamic import is deliberately inside the phase budget; no Prisma CLI generation.
   activeArm.stage='offline_bootstrap';
   const bootstrap=await require('./prepare-empty-research-schema-offline.cjs').prepareEmptyResearchSchemaOffline({storageSchema:a.schema,auditDirectory:bootstrapOut,deadlineUtc});
   activeArm.bootstrap_status=bootstrap.status;activeArm.bootstrap_committed=bootstrap.committed;
   requireThat(bootstrap.passed===true&&bootstrap.committed===true&&bootstrap.target_schema===a.schema&&bootstrap.within_registered_deadline===true,'offline_bootstrap_incomplete:'+a.id);
   requireThat(!stopSignal&&Date.now()<deadline,'arm_wall_or_interrupt_before_runtime');
   const c=JSON.parse(cp.execFileSync('docker',['inspect','roi-close-atomic-test-20261003'],{encoding:'utf8',timeout:Math.min(15000,deadline-Date.now())}))[0],binding=c.NetworkSettings.Ports['5432/tcp'][0];
   requireThat(c.State.Status==='running'&&binding.HostPort==='55439'&&binding.HostIp==='127.0.0.1','isolated_database_required');
   const e=Object.fromEntries(c.Config.Env.map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));requireThat(e.POSTGRES_DB==='crypto_reset_test'&&e.POSTGRES_USER&&e.POSTGRES_PASSWORD,'isolated_database_identity_required');
   const u=new URL('postgresql://127.0.0.1:55439/crypto_reset_test');u.username=e.POSTGRES_USER;u.password=e.POSTGRES_PASSWORD;u.searchParams.set('connection_limit','1');
   requireThat(Date.now()<deadline,'arm_wall_before_spawn');const fd=fs.openSync(path.join(audit,a.id+'-run.log'),'wx',0o600);
   const supervised=superviseHistoricalProcess({executable:process.execPath,args:[resolve(runners[a.mode]),out,reg.start,reg.end,reg.provider_mode,receiptFile,resolve(reg.runtime_root),resolve(reg.policy_file),'checkpoints',experimentFile],options:{cwd:root,env:{...process.env,ROI_ATOMIC_TEST_DATABASE_URL:u.toString()},stdio:['ignore',fd,fd]},processFile:path.join(audit,a.id+'-process.json'),terminalFile:path.join(audit,a.id+'-process-terminal.json')});fs.closeSync(fd);
   activeArm.stage='runner_started';activeArm.pid=supervised.child.pid;
   const cutoff=setTimeout(()=>supervised.child.kill('SIGTERM'),Math.max(0,deadline-Date.now())),forced=setTimeout(()=>supervised.child.kill('SIGKILL'),Math.max(0,deadline+reg.cleanup_seconds*1000-Date.now()));
   let terminal;try{terminal=await supervised.completion;}finally{clearTimeout(cutoff);clearTimeout(forced);}
   activeArm.stage='terminal_integrity_verification';activeArm.process_terminal=terminal;
   requireThat(!stopSignal,'launcher_interrupted');requireThat(fs.existsSync(path.join(out,'result.json'))&&fs.existsSync(path.join(out,'manifest.json')),'arm_terminal_artifacts_missing:'+a.id);
   const result=read(path.join(out,'result.json')),manifest=read(path.join(out,'manifest.json')),cost=checkTerminal({reg,a,result,manifest,terminal,registered,receiptSha,effectiveCostCap});hashes(reg);
   report.new_reported_provider_cost_usd+=cost.new_reported_invoice_cost_usd;report.operating_ai_cost_usd+=cost.operating_ai_cost_usd;
   activeArm.operating_costs_already_counted=true;
   requireThat(report.new_reported_provider_cost_usd<=reg.max_combined_new_reported_provider_cost_usd+1e-10,'combined_new_provider_budget_exceeded');
   const summary={id:a.id,mode:a.mode,arm:a.arm,schema:a.schema,status:'full_valid_arm',elapsed_including_bootstrap_ms:Date.now()-armStarted,...cost,terminal,all_cost_roi:null,independent_quality_fills:null};report.arms.push(summary);write(a.id+'-verified-terminal.json',summary);
   activeArm=null;
   if(a.arm==='candidate'){
    const check=candidateNecessaryCondition(result,reg.capital,reg.end);write(a.id+'-necessary-condition.json',check);
    if(check.decision==='reject_registered_candidate'){report.status='candidate_rejected_before_following_arm';report.rejected_arm=a.id;report.failure_reasons=check.failure_reasons;write('four-arm-terminal.json',report);return report;}
   }
  }
  report.status='four_arms_complete_economic_assessment_required';report.all_attempts_cost_coverage='all_four_terminal_operating_costs_verified';report.cost_rule='modeled fees/funding already in equity; subtract each AI use once; infrastructure/execution-fidelity/quality proof remains separate';write('four-arm-terminal.json',report);return report;
 }catch(error){
  report.status='four_arm_failed_or_incomplete';report.failure=String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted-db-url]');
  report.cost_totals_partial=true;report.all_attempts_cost_coverage='partial_or_unknown_in_failed_attempt';report.total_new_reported_cost_all_attempts_usd=null;report.total_operating_ai_cost_all_attempts_usd=null;
  if(activeArm){
   report.current_arm_attempt={...activeArm,cost_coverage:'not_verified',known_new_cost_subtotal_usd:null,known_reused_cost_subtotal_usd:null};
   try{
    const f=path.join(activeArm.run_directory,'result.json'),receiptFile=path.join(activeArm.run_directory,'provider-receipts.json'),r=fs.existsSync(f)?read(f):null;
    const newRows=Array.isArray(r?.network_receipts)?r.network_receipts:fs.existsSync(receiptFile)?read(receiptFile):null,reusedRows=r?.receipt_replays;
    for(const [field,rows,costOf]of [['known_new_cost_subtotal_usd',newRows,x=>x.response?.usage?.cost],['known_reused_cost_subtotal_usd',reusedRows,x=>x.reported_cost]])if(Array.isArray(rows)){report.current_arm_attempt[field]=rows.map(costOf).filter(validCost).reduce((s,c)=>s+c,0);report.current_arm_attempt[field+'_unknown_requests']=rows.filter(x=>!validCost(costOf(x))).length;}
    report.current_arm_attempt.retained_terminal_status=r?.status??'terminal_result_missing';report.current_arm_attempt.inflight_or_unrecorded_requests_unknown=true;
   }catch{report.current_arm_attempt.retained_cost_read_failed=true;}
  }
  const failedNew=report.current_arm_attempt?.operating_costs_already_counted?0:report.current_arm_attempt?.known_new_cost_subtotal_usd,failedReuse=report.current_arm_attempt?.operating_costs_already_counted?0:report.current_arm_attempt?.known_reused_cost_subtotal_usd;
  report.recorded_new_provider_cost_all_attempts_subtotal_usd=report.new_reported_provider_cost_usd+(validCost(failedNew)?failedNew:0);
  report.recorded_operating_ai_cost_all_attempts_subtotal_usd=report.operating_ai_cost_usd+(validCost(failedNew)?failedNew:0)+(validCost(failedReuse)?failedReuse:0);
  report.recorded_subtotals_are_incomplete_lower_bounds=true;
  write('four-arm-failure.json',report);throw error;
 }
 finally{process.removeListener('SIGINT',onInt);process.removeListener('SIGTERM',onTerm);}
}
if(require.main===module)launch(process.argv[2],process.argv[3]).then(r=>console.log(JSON.stringify({status:r.status,completed_arms:r.arms.length,economic_goal_proven:false,promotion_allowed:false}))).catch(error=>{console.error(String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted-db-url]'));process.exitCode=1;});
module.exports={launch,validateRegistration};

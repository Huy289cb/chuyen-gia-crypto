'use strict';
// Pure terminal-file assessment. Importing this module reads nothing and runs nothing.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {candidateNecessaryCondition}=require('./candidate-portfolio-necessary-condition.cjs');
const root=path.resolve(__dirname,'../..'),ids=['base_candidate','base_baseline','stress_candidate','stress_baseline'];
const cost=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const resolve=f=>path.isAbsolute(f)?f:path.join(root,f);
const safe=s=>String(s).replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted-db-url]');

function assessFourArmSharedEnginePortfolio({auditDirectory}){
 const audit=resolve(auditDirectory);if(!audit.startsWith(path.join(root,'docs/audits')+path.sep))throw Error('explicit_actual_research_audit_required');
 const inputs={},readErrors=[];
 const read=(file)=>{const f=path.isAbsolute(file)?file:path.join(audit,file),key=path.relative(root,f);try{const bytes=fs.readFileSync(f);inputs[key]=hash(bytes);return JSON.parse(bytes);}catch(e){inputs[key]=e.code==='ENOENT'?'missing':'unreadable';if(e.code!=='ENOENT')readErrors.push({file:key,error:safe(e.message)});return null;}};
 const reg=read('registration.json'),terminal=read('four-arm-terminal.json'),failure=read('four-arm-failure.json');
 const report={version:'four-arm-terminal-economic-assessment-v1',audit_directory:audit,assessed_at:new Date().toISOString(),status:'incomplete_or_failed_measurement',decision:'economic_measurement_inconclusive',economic_goal_proven:false,promotion_allowed:false,development_only:true,all_cost_roi_base:null,roi_stress:null,independent_quality_fill_uplift:null,added_cohort_net_expectancy:null,incremental_infrastructure_cost_usd:null,arms:{},comparisons:{},failure_reasons:[],limits:['Previously viewed February development data; no unseen/prospective confirmation','Modeled historical fills/fees/funding/slippage do not prove live execution fidelity','Distinct filled OPEN order counts are not independent quality clusters','Terminal exports omit complete entry/root/wave events; absent lineage remains unknown'],cost_rule:'Exchange marked equity and position realized_pnl already include modeled fees/funding/price impact; subtract every new and replayed AI operating occurrence once. New invoice and operating cost are separate.'};
 const check=(ok,reason,errors)=>{if(!ok)errors.push(reason);};
 const global=[];
 check(reg?.version==='four-arm-shared-engine-portfolio-v1'&&reg.execution==='serial'&&reg.promotion_allowed===false,'registered_four_arm_scope_missing',global);
 check(same(reg?.arm_order,ids)&&Array.isArray(reg?.arms)&&reg.arms.length===4,'registered_four_arm_order_missing',global);
 check(reg?.capital===31.47744546&&Number.isFinite(Date.parse(reg?.start))&&Number.isFinite(Date.parse(reg?.end))&&Date.parse(reg.end)>Date.parse(reg.start),'registered_capital_window_invalid',global);
 const policy=reg?.policy_file?read(resolve(reg.policy_file)):null;
 const initial=reg?.provider_receipts_file?read(resolve(reg.provider_receipts_file)):null;
 check(Boolean(policy?.environment)&&Array.isArray(initial),'registered_policy_or_receipt_inputs_missing',global);
 if(reg){
  for(const [f,expected]of Object.entries(reg.source_hashes??{})){try{const actual=hash(fs.readFileSync(resolve(f)));inputs[path.relative(root,resolve(f))]=actual;check(actual===expected,'frozen_source_changed:'+path.basename(f),global);}catch{inputs[path.relative(root,resolve(f))]='missing';global.push('frozen_source_missing:'+path.basename(f));}}
  check(inputs[path.relative(root,resolve(reg.policy_file??''))]===reg.policy_sha256,'registered_policy_hash_mismatch',global);
  check(inputs[path.relative(root,resolve(reg.provider_receipts_file??''))]===reg.provider_receipts_sha256,'registered_receipt_hash_mismatch',global);
  if(reg.dataset?.file){try{const actual=hash(fs.readFileSync(resolve(reg.dataset.file)));inputs[path.relative(root,resolve(reg.dataset.file))]=actual;check(actual===reg.dataset.sha256,'registered_dataset_hash_mismatch',global);}catch{global.push('registered_dataset_missing');}}
 }
 check(Boolean(terminal||failure),'launcher_terminal_or_failure_missing',global);
 if(terminal)check(terminal.registration_sha256===inputs[path.relative(root,path.join(audit,'registration.json'))],'launcher_terminal_registration_mismatch',global);
 if(failure)check(failure.registration_sha256===inputs[path.relative(root,path.join(audit,'registration.json'))],'launcher_failure_registration_mismatch',global);
 report.launcher={status:terminal?.status??failure?.status??'no_terminal_control',failure:failure?.failure??null,verified_completed_arms:terminal?.arms??failure?.arms??[],all_attempts_cost_coverage:terminal?.all_attempts_cost_coverage??failure?.all_attempts_cost_coverage??'unknown',recorded_new_cost_lower_bound_usd:failure?.recorded_new_provider_cost_all_attempts_subtotal_usd??null,recorded_operating_cost_lower_bound_usd:failure?.recorded_operating_ai_cost_all_attempts_subtotal_usd??null,current_failed_attempt:failure?.current_arm_attempt??null};
 if(failure)global.push('launcher_failed_or_incomplete');
 const infra=reg?.cost_accounting?.incremental_infrastructure_cost_usd_per_arm;
 for(const id of ids){
  const a=reg?.arms?.find(x=>x.id===id),r=read(id+'-run/result.json'),m=read(id+'-run/manifest.json'),p=read(id+'-process-terminal.json'),verified=read(id+'-verified-terminal.json'),startControl=read(id+'-arm-start.json');
  const fallback=r?.network_receipts??read(id+'-run/provider-receipts.json');
  const newRows=Array.isArray(fallback)?fallback:null,reusedRows=Array.isArray(r?.receipt_replays)?r.receipt_replays:null;
  const newValues=newRows?.map(x=>x.response?.usage?.cost),reuseValues=reusedRows?.map(x=>x.reported_cost);
  const sumKnown=values=>values?values.filter(cost).reduce((s,n)=>s+n,0):null;
  const summary={id,mode:a?.mode??id.split('_')[0],arm:a?.arm??id.split('_')[1],status:'unverified_or_incomplete',full_valid:false,terminal_status:r?.status??'missing',process_exit_code:p?.exit_code??null,terminal_last_evaluated_at:r?.last_evaluated_at??null,known_new_invoice_cost_subtotal_usd:sumKnown(newValues),known_reused_operating_cost_subtotal_usd:sumKnown(reuseValues),unknown_cost_requests:newValues&&reuseValues?[...newValues,...reuseValues].filter(x=>!cost(x)).length:null,cost_coverage:'partial_or_unknown',operating_ai_cost_usd:null,capital:reg?.capital??null,marked_equity:null,modeled_net_after_known_ai_costs_usd:null,modeled_known_cost_roi_percent:null,all_cost_roi_percent:null,entry_orders:null,independent_quality_clusters:null,additional_cohort_net_expectancy:null,validation_errors:[]};
  summary.recorded_new_requests=newValues?.length??null;summary.recorded_reused_requests=reuseValues?.length??null;
  summary.recorded_prefix_exchange_equity_usd=Number.isFinite(r?.exchange?.equity)?r.exchange.equity:null;
  summary.recorded_prefix_exchange_quantity=Number.isFinite(r?.exchange?.quantity)?r.exchange.quantity:null;
  summary.recorded_prefix_entry_orders=null;
  if(Array.isArray(r?.exchange?.orders)&&Array.isArray(r?.exchange?.fills)){const observedOrders=new Map(r.exchange.orders.map(o=>[String(o.orderId),o]));if(r.exchange.fills.every(f=>observedOrders.has(String(f.orderId))))summary.recorded_prefix_entry_orders=new Set(r.exchange.fills.filter(f=>observedOrders.get(String(f.orderId)).intent==='OPEN').map(f=>String(f.orderId))).size;}
  summary.recorded_prefix_metrics_are_economic_proof=false;
  report.arms[id]=summary;const errors=summary.validation_errors;
  check(Boolean(a&&r&&m&&p&&verified),'actual_arm_terminal_controls_missing',errors);
  if(!r||!m||!a)continue;
  const d=r.diagnostics,e=r.exchange;
  check(p?.exit_code===0&&!p.signal&&!p.spawn_error&&r.status==='integration_window_completed'&&r.last_evaluated_at===Date.parse(reg.end)&&r.terminal_export_complete===true,'arm_not_full_completed_terminal',errors);
  check(Array.isArray(r.terminal_command_gaps)&&r.terminal_command_gaps.length===0&&d&&['database_errors','adapter_failures','unavailable_dependencies','provider_errors'].every(k=>Array.isArray(d[k])&&d[k].length===0)&&!d.checkpoint_failure&&!d.database_boundary_failure,'arm_integrity_failed_or_missing',errors);
  check(verified?.status==='full_valid_arm'&&verified.id===id&&verified.schema===a.schema&&same(verified.terminal,p),'launcher_verified_terminal_missing_or_mismatch',errors);
  check((terminal?.arms??failure?.arms??[]).some(x=>same(x,verified)),'launcher_control_does_not_attest_verified_arm',errors);
  check(m.start===reg.start&&m.end===reg.end&&m.capital===reg.capital&&m.storage_schema===a.schema&&m.causal_experiment?.arm===a.arm&&m.causal_experiment?.prepared_schema===a.schema&&m.causal_experiment?.warmup_start===reg.warmup_start,'registered_arm_scope_mismatch',errors);
  check(m.causal_experiment?.max_wall_seconds===a.max_wall_seconds&&m.causal_experiment?.max_provider_calls===a.max_new_provider_calls&&same(m.causal_experiment?.hashes,reg.source_hashes),'registered_experiment_identity_mismatch',errors);
  check(same(m.environment,policy?.environment)&&same(m.dataset,reg.dataset)&&same(m.runtime_js_hashes,reg.runtime_js_hashes)&&m.provider_receipts_sha256===reg.provider_receipts_sha256&&m.provider_mode==='exact_receipts_then_real_new_requests','registered_inputs_manifest_mismatch',errors);
  check(m.max_provider_calls===a.max_new_provider_calls&&cost(m.max_new_reported_provider_cost_usd)&&m.max_new_reported_provider_cost_usd>0&&m.max_new_reported_provider_cost_usd<=a.max_new_reported_provider_cost_usd&&m.causal_experiment?.max_reported_cost_usd===m.max_new_reported_provider_cost_usd,'registered_provider_budget_manifest_mismatch',errors);
  check(startControl?.bootstrap_included_in_wall===true&&startControl.effective_new_reported_cost_cap===m.max_new_reported_provider_cost_usd&&startControl.receipt_sha256===reg.provider_receipts_sha256,'actual_arm_start_budget_or_receipt_control_mismatch',errors);
  check(m.execution_model?.fee_rate===.0005&&m.execution_model.min_qty===.001&&m.execution_model.step_size===.001&&m.execution_model.min_notional===50,'execution_contract_mismatch',errors);
  check(a.mode==='stress'?m.execution_model?.stress_version==='penetration-adverse-market-v1'&&m.execution_model.limit_penetration===.001&&m.execution_model.market_adverse_slippage===.001:!m.execution_model?.stress_version,'registered_execution_mode_mismatch',errors);
  check(m.source_hashes&&Object.keys(m.source_hashes).length>0&&Object.entries(m.source_hashes).every(([f,h])=>reg.source_hashes?.[path.resolve(__dirname,f)]===h||reg.source_hashes?.[path.relative(root,path.resolve(__dirname,f))]===h),'arm_manifest_source_not_registered',errors);
  check(newValues&&reuseValues&&[...newValues,...reuseValues].every(cost)&&!r.provider_cost_unknown&&!r.provider_budget_exceeded,'terminal_operating_cost_coverage_missing',errors);
  check(Array.isArray(r.network_receipts)&&r.network_receipts.length<=a.max_new_provider_calls&&r.provider_receipt_replay?.source_sha256===reg.provider_receipts_sha256&&Array.isArray(r.provider_receipt_replay?.used)&&r.provider_receipt_replay.used.length===reusedRows?.length,'receipt_coverage_missing_or_mismatch',errors);
  check(newRows&&reusedRows&&newRows.every(x=>Number.isFinite(x.at)&&x.at>=Date.parse(reg.start)&&x.at<=Date.parse(reg.end))&&reusedRows.every(x=>Number.isFinite(x.at)&&x.at>=Date.parse(reg.start)&&x.at<=Date.parse(reg.end))&&new Set(reusedRows.map(x=>x.index)).size===reusedRows.length,'receipt_clock_or_duplicate_queue_use_mismatch',errors);
  check(cost(r.new_reported_provider_cost_usd)&&newValues&&Math.abs(sumKnown(newValues)-r.new_reported_provider_cost_usd)<=1e-10&&r.new_reported_provider_cost_usd<=m.max_new_reported_provider_cost_usd+1e-10,'invoice_cost_sum_or_budget_mismatch',errors);
  check(newValues&&reuseValues&&cost(verified?.new_reported_invoice_cost_usd)&&Math.abs(verified.new_reported_invoice_cost_usd-sumKnown(newValues))<=1e-10&&cost(verified?.operating_ai_cost_usd)&&Math.abs(verified.operating_ai_cost_usd-sumKnown(newValues)-sumKnown(reuseValues))<=1e-10,'verified_arm_operating_cost_mismatch',errors);
  if(reusedRows&&Array.isArray(r.provider_receipt_replay?.used))for(let i=0;i<reusedRows.length;i++){
   const use=reusedRows[i],u=r.provider_receipt_replay.used[i],row=initial?.[use.index];
   check(u&&row&&same(u,{index:use.index,input_sha256:use.input_sha256,original_at:use.original_at,reported_cost:use.reported_cost})&&row.at===use.original_at&&row.response?.usage?.cost===use.reported_cost,'reused_receipt_lineage_mismatch',errors);
   if(row){try{const url=new URL(row.url);check(hash(JSON.stringify([url.origin+url.pathname,canonical(row.body)]))===use.input_sha256,'reused_receipt_request_hash_mismatch',errors);}catch{errors.push('reused_receipt_url_invalid');}}
  }
  check(e&&Number.isFinite(e.equity)&&Number.isFinite(e.wallet)&&Number.isFinite(e.unrealizedPnl)&&Math.abs(e.equity-e.wallet-e.unrealizedPnl)<=1e-8&&Array.isArray(e.orders)&&Array.isArray(e.fills)&&Array.isArray(e.funding),'exchange_terminal_money_missing',errors);
  if(errors.length||global.some(x=>x!=='launcher_failed_or_incomplete'))continue;
  const orders=new Map(e.orders.map(o=>[String(o.orderId),o]));
  check(orders.size===e.orders.length&&e.orders.every(o=>o.orderId!==undefined&&['OPEN','CLOSE'].includes(o.intent))&&e.fills.every(f=>orders.has(String(f.orderId))&&Number.isFinite(f.qty)&&f.qty>0&&cost(f.commission)&&Number.isFinite(f.time)&&f.time<=Date.parse(reg.end)),'actual_fill_order_lineage_missing',errors);
  if(errors.length)continue;
  const entries=[...new Set(e.fills.filter(f=>orders.get(String(f.orderId)).intent==='OPEN').map(f=>String(f.orderId)))];
  const admissions=(r.causal_inventory?.decisions??[]).filter(x=>x.result?.execution?.success),filled=admissions.filter(x=>entries.includes(String(x.result.execution.binanceOrderId)));
  check(filled.every(x=>x.setup_id&&x.result.execution.orderId&&Array.isArray(r.final_pending)&&r.final_pending.some(o=>o.order_id===x.result.execution.orderId&&String(o.binance_order_id)===String(x.result.execution.binanceOrderId))&&Array.isArray(r.final_positions)&&r.final_positions.some(position=>String(position.binance_order_id)===String(x.result.execution.binanceOrderId)&&position.side!=='NONE')),'causal_pending_position_fill_join_missing',errors);
  if(errors.length)continue;
  const ai=sumKnown(newValues)+sumKnown(reuseValues),net=e.equity-reg.capital-ai,incremental=infra?.[id];
  Object.assign(summary,{status:'full_valid_modeled_arm',full_valid:true,cost_coverage:'terminal_operating_ai_costs_verified',operating_ai_cost_usd:ai,capital:reg.capital,marked_equity:e.equity,wallet:e.wallet,unrealized_pnl:e.unrealizedPnl,modeled_net_after_known_ai_costs_usd:net,modeled_known_cost_roi_percent:100*net/reg.capital,incremental_infrastructure_cost_usd:cost(incremental)?incremental:null,all_cost_roi_percent:cost(incremental)?100*(net-incremental)/reg.capital:null,entry_orders:entries.length,entry_order_ids:entries,entry_fill_executions:e.fills.filter(f=>orders.get(String(f.orderId)).intent==='OPEN').length,causal_filled_setup_ids:[...new Set(filled.map(x=>x.setup_id))],causal_fill_lineage:filled.map(x=>({setup_id:x.setup_id,entry_exchange_order_id:String(x.result.execution.binanceOrderId),internal_order_id:x.result.execution.orderId,decision_id:x.result.review?.decisionRecordId??null,trace_id:x.result.review?.trace?.trace_id??null,setup_identity:x.result.review?.trace?.setup_identity??null})),commission_already_in_equity_usd:e.fills.reduce((s,f)=>s+f.commission,0),funding_already_in_equity_usd:e.funding.reduce((s,f)=>s+f.income,0),closed_positions:r.final_positions.filter(x=>x.side!=='NONE'&&x.status==='closed').length,open_positions:r.final_positions.filter(x=>x.side!=='NONE'&&x.status==='open').length,pending_orders:r.final_pending.filter(x=>x.status==='pending').length});
  if(a.arm==='candidate'){try{summary.necessary_condition=candidateNecessaryCondition(r,reg.capital,reg.end);}catch(e2){summary.full_valid=false;summary.validation_errors.push('candidate_necessary_check_failed:'+safe(e2.message));}}
 }
 const reject=[];
 for(const mode of ['base','stress']){
  const c=report.arms[mode+'_candidate'],b=report.arms[mode+'_baseline'];
  const pair={full_matched:false,status:'incomplete_or_failed',candidate_all_cost_roi_percent:null,baseline_all_cost_roi_percent:null,entry_order_uplift:null,independent_quality_fill_uplift:null,added_cohort_net_expectancy:null};report.comparisons[mode]=pair;
  if(c.full_valid&&c.necessary_condition?.decision==='reject_registered_candidate')reject.push(...c.necessary_condition.failure_reasons.map(x=>mode+':'+x));
  if(c.full_valid&&b.full_valid){Object.assign(pair,{full_matched:true,status:'full_matched_development_model',candidate_known_cost_net_usd:c.modeled_net_after_known_ai_costs_usd,baseline_known_cost_net_usd:b.modeled_net_after_known_ai_costs_usd,known_cost_net_uplift_usd:c.modeled_net_after_known_ai_costs_usd-b.modeled_net_after_known_ai_costs_usd,candidate_all_cost_roi_percent:c.all_cost_roi_percent,baseline_all_cost_roi_percent:b.all_cost_roi_percent,entry_order_uplift:c.entry_orders-b.entry_orders,entry_order_uplift_is_independence_proof:false});}
 }
 if(readErrors.length)global.push(...readErrors.map(x=>'input_read_failed:'+x.file));
 const all=ids.every(id=>report.arms[id].full_valid),early=terminal?.status==='candidate_rejected_before_following_arm';
 if(all&&terminal?.status==='four_arms_complete_economic_assessment_required'&&global.length===0){report.status='four_full_matched_modeled_arms_assessed';report.decision=reject.length?'reject_registered_candidate':'economic_confirmation_insufficient';report.operating_ai_cost_all_arms_usd=ids.reduce((s,id)=>s+report.arms[id].operating_ai_cost_usd,0);report.new_invoice_cost_all_arms_usd=ids.reduce((s,id)=>s+report.arms[id].known_new_invoice_cost_subtotal_usd,0);if(report.new_invoice_cost_all_arms_usd>reg.max_combined_new_reported_provider_cost_usd+1e-10){global.push('combined_invoice_budget_exceeded');report.status='incomplete_or_failed_measurement';report.decision='economic_measurement_inconclusive';}}
 else if(early&&reject.length&&global.length===0){report.status='full_valid_candidate_necessary_condition_rejected';report.decision='reject_registered_candidate';}
 if(report.status==='four_full_matched_modeled_arms_assessed'){report.all_cost_roi_base=report.comparisons.base.candidate_all_cost_roi_percent;report.roi_stress=report.comparisons.stress.candidate_all_cost_roi_percent;report.roi_unit='percent';}
 report.failure_reasons=report.decision==='reject_registered_candidate'?reject:[];
 report.measurement_errors=[...global,...readErrors.map(x=>'input_read_failed:'+x.file)];
 report.input_hashes=inputs;report.assessor_source_sha256=hash(fs.readFileSync(__filename));
 report.input_fingerprint=hash(JSON.stringify(canonical({inputs,assessor_source_sha256:report.assessor_source_sha256})));
 return report;
}

function writeAssessment(report){
 const audit=report.audit_directory,fingerprint=report.input_fingerprint;
 const jsonName='terminal-assessment-'+fingerprint+'.json',mdName='terminal-assessment-'+fingerprint+'.md';
 const atomic=(name,bytes)=>{const target=path.join(audit,name),tmp=target+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,bytes,{flag:'wx',mode:0o600});fs.renameSync(tmp,target);};
 if(!fs.existsSync(path.join(audit,jsonName))){
  const rows=ids.map(id=>{const a=report.arms[id];return `| ${id} | ${a.status} | ${a.entry_orders??'unknown'} | ${a.modeled_net_after_known_ai_costs_usd??'unknown'} | ${a.all_cost_roi_percent??'unknown'} |`;}).join('\n');
  const md=`# Four-arm terminal financial assessment\n\n${report.status}; decision: ${report.decision}. Economic goal proven=false; promotion allowed=false.\n\n| Arm | Integrity/scope | Distinct filled OPEN orders | Modeled net after known AI, USD | All-cost ROI, % |\n|---|---|---:|---:|---:|\n${rows}\n\nFees/funding/modeled slippage already enter exchange equity; AI is charged per actual new/reused operating use once. Infrastructure remains unknown unless explicitly recorded. Failed-arm cost subtotals are lower bounds, not complete costs.\n\nIndependent quality fills, additional cohort expectancy and unseen/prospective confirmation remain unknown. Previously viewed February is development. ${report.launcher.failure?'Launcher failure: '+report.launcher.failure+'. ':''}${report.failure_reasons.length?'Registered rejection: '+report.failure_reasons.join(', ')+'. ':''}\n\nInput fingerprint: ${fingerprint}.\n`;
  atomic(mdName,md);atomic(jsonName,JSON.stringify(report,null,2)+'\n');
 }
 const retained=JSON.parse(fs.readFileSync(path.join(audit,jsonName),'utf8'));
 atomic('terminal-assessment.json',JSON.stringify(retained,null,2)+'\n');atomic('terminal-assessment.md',fs.readFileSync(path.join(audit,mdName)));
 return retained;
}
if(require.main===module){try{const auditDirectory=process.argv[2];if(!auditDirectory)throw Error('ACTUAL_AUDIT_DIRECTORY_REQUIRED');const report=writeAssessment(assessFourArmSharedEnginePortfolio({auditDirectory}));console.log(JSON.stringify({status:report.status,decision:report.decision,economic_goal_proven:false,promotion_allowed:false,input_fingerprint:report.input_fingerprint}));}catch(e){console.error(safe(e.message));process.exitCode=1;}}
module.exports={assessFourArmSharedEnginePortfolio,writeAssessment};

'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {superviseHistoricalProcess}=require('./historical-process-supervisor.cjs');
const {inspectPortfolioStorage}=require('./isolated-portfolio-storage-preflight.cjs');
const {candidateNecessaryCondition}=require('./candidate-portfolio-necessary-condition.cjs');
async function launch(){
 const root=path.resolve(__dirname,'../..'),audit=path.resolve(process.env.ROI_SERIAL_MONTH_AUDIT||path.join(root,'docs/audits/2026-10-08-proposed-serial-month'));
 const registration=JSON.parse(fs.readFileSync(path.join(audit,'registration-proposal.json')));
 if(registration.approval_status!=='user_approved_12h_serial')throw Error('explicit_new_wall_budget_approval_required');
 if(registration.max_wall_seconds_per_arm!==43200||registration.max_new_reported_provider_cost_usd_per_arm!==1||registration.max_new_provider_calls_per_arm!==1500)throw Error('registered_budget_mismatch');
 if(registration.reject_nonviable_candidate_before_baseline&&JSON.stringify(registration.arm_order)!==JSON.stringify(['candidate','baseline']))throw Error('candidate_first_required_for_registered_early_rejection');
 for(const arm of registration.arm_order){
  const experiment=JSON.parse(fs.readFileSync(path.join(audit,arm+'-experiment.json')));
  for(const [file,expected]of Object.entries(experiment.hashes)){if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==expected)throw Error('frozen_source_changed:'+path.basename(file));}
  if(fs.existsSync(path.join(audit,arm+'-run')))throw Error('new_output_required_no_restart');
  const storage=inspectPortfolioStorage();
  fs.writeFileSync(path.join(audit,arm+'-storage-preflight.json'),JSON.stringify(storage,null,2),{flag:'wx'});
  const c=JSON.parse(cp.execFileSync('docker',['inspect','roi-close-atomic-test-20261003'],{encoding:'utf8'}))[0];
  const binding=c.NetworkSettings.Ports['5432/tcp'][0];if(binding.HostPort!=='55439'||binding.HostIp!=='127.0.0.1')throw Error('isolated_only');
  const e=Object.fromEntries(c.Config.Env.map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)]}));
  const u=new URL('postgresql://127.0.0.1:55439/crypto_reset_test');u.username=e.POSTGRES_USER;u.password=e.POSTGRES_PASSWORD;u.searchParams.set('connection_limit','1');
  const fd=fs.openSync(path.join(audit,arm+'-run.log'),'wx',0o600);
  const supervised=superviseHistoricalProcess({executable:process.execPath,args:[path.join(root,registration.runner),path.join(audit,arm+'-run'),registration.start,registration.end,'hybrid',registration.provider_receipts_file??path.join(root,'docs/audits/2026-10-07-matched-causal-portfolio/provider-receipts.json'),registration.runtime_root,registration.policy_file,'checkpoints',path.join(audit,arm+'-experiment.json')],options:{cwd:root,env:{...process.env,ROI_ATOMIC_TEST_DATABASE_URL:u.toString()},stdio:['ignore',fd,fd]},processFile:path.join(audit,arm+'-process.json'),terminalFile:path.join(audit,arm+'-process-terminal.json')});fs.closeSync(fd);
  // Graceful stop first, then finite terminal cleanup; never restart on timeout.
  const cutoff=setTimeout(()=>supervised.child.kill('SIGTERM'),43200*1000);
  const forced=setTimeout(()=>supervised.child.kill('SIGKILL'),(43200+120)*1000);
  let terminal;try{terminal=await supervised.completion;}finally{clearTimeout(cutoff);clearTimeout(forced);}
  const resultFile=path.join(audit,arm+'-run/result.json');if(!fs.existsSync(resultFile))throw Error('terminal_export_missing:'+arm);
  const r=JSON.parse(fs.readFileSync(resultFile)),d=r.diagnostics;
  if(terminal.exit_code!==0||r.status!=='integration_window_completed'||r.last_evaluated_at!==Date.parse(registration.end)||!r.terminal_export_complete||!Array.isArray(r.terminal_command_gaps)||r.terminal_command_gaps.length||!d||!['database_errors','adapter_failures','unavailable_dependencies'].every(k=>Array.isArray(d[k])&&d[k].length===0)||d.checkpoint_failure)throw Error('registered_arm_incomplete_or_integrity_failed:'+arm);
  if(arm==='candidate'&&registration.reject_nonviable_candidate_before_baseline){
   const m=JSON.parse(fs.readFileSync(path.join(audit,arm+'-run/manifest.json')));
   if(m.capital!==registration.capital||m.start!==registration.start||m.end!==registration.end||m.causal_experiment?.arm!==arm)throw Error('candidate_registered_economic_scope_mismatch');
   if(JSON.stringify(m.environment)!==JSON.stringify(JSON.parse(fs.readFileSync(registration.policy_file)).environment))throw Error('candidate_policy_manifest_mismatch');
   const check=candidateNecessaryCondition(r,registration.capital,registration.end);
   fs.writeFileSync(path.join(audit,'candidate-necessary-condition.json'),JSON.stringify(check,null,2),{flag:'wx'});
   if(check.decision==='reject_registered_candidate'){
    fs.writeFileSync(path.join(audit,'pair-terminal.json'),JSON.stringify({status:'candidate_rejected_before_baseline',reason:check.failure_reasons,economic_goal_proven:false,at:Date.now()},null,2),{flag:'wx'});
    return check;
   }
  }
 }
 fs.writeFileSync(path.join(audit,'pair-terminal.json'),JSON.stringify({status:'both_arms_terminal_requires_economic_assessment',economic_goal_proven:false,at:Date.now()},null,2),{flag:'wx'});
}
if(require.main===module)launch().then(async(preliminary)=>{const report=preliminary??await require('./assess-serial-monthly-portfolio.cjs').assess();fs.writeFileSync(path.join(process.env.ROI_SERIAL_MONTH_AUDIT||path.resolve(__dirname,'../../docs/audits/2026-10-08-proposed-serial-month'),'assessment.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,decision:report.decision,economic_goal_proven:report.economic_goal_proven}));}).catch(error=>{const failure={status:'serial_pair_failed_or_incomplete',failure:error.message,at:Date.now(),economic_goal_proven:false};fs.writeFileSync(path.join(process.env.ROI_SERIAL_MONTH_AUDIT||path.resolve(__dirname,'../../docs/audits/2026-10-08-proposed-serial-month'),'pair-failure.json'),JSON.stringify(failure,null,2));console.error(error.message);process.exitCode=1;});
module.exports={launch};

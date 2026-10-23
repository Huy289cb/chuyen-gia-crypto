'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),{PrismaClient}=require('@prisma/client');
const audit=path.resolve(__dirname,'../../docs/audits/2026-10-07-approved-monthly-portfolio');
const read=p=>JSON.parse(fs.readFileSync(p));const validCost=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
async function assess(){
 const arms={};for(const name of ['baseline','candidate']){const dir=path.join(audit,name+'-run'),file=path.join(dir,'result.json');if(!fs.existsSync(file))return {status:'terminal_evidence_missing',missing_arm:name,economic_goal_proven:false};arms[name]={result:read(file),manifest:read(path.join(dir,'manifest.json'))};}
 for(const [name,a]of Object.entries(arms))if(!a.result.terminal_export_complete)return {status:'terminal_export_incomplete',arm:name,economic_goal_proven:false};
 for(const [name,a]of Object.entries(arms)){
  const r=a.result,d=r.diagnostics;
  if(!Array.isArray(r.terminal_command_gaps)||!d||!['database_errors','adapter_failures','unavailable_dependencies'].every(k=>Array.isArray(d[k])))return {status:'terminal_integrity_evidence_missing',arm:name,economic_goal_proven:false};
  if(r.terminal_command_gaps.length||d.database_errors.length||d.adapter_failures.length||d.unavailable_dependencies.length||d.checkpoint_failure)return {status:'terminal_integrity_failed',arm:name,command_gaps:r.terminal_command_gaps,database_errors:d.database_errors,adapter_failures:d.adapter_failures,unavailable_dependencies:d.unavailable_dependencies,checkpoint_failure:d.checkpoint_failure,economic_goal_proven:false};
 }
 const bm=arms.baseline.manifest,cm=arms.candidate.manifest;
 for(const key of ['start','end','capital','dataset','environment','runtime_js_hashes','execution_model','provider_receipts_sha256'])if(JSON.stringify(bm[key])!==JSON.stringify(cm[key]))throw Error('matched_manifest_mismatch:'+key);
 const clocks=Object.values(arms).map(a=>a.result.last_evaluated_at);if(!clocks.every(Number.isFinite))return {status:'no_common_fully_evaluated_prefix',economic_goal_proven:false,arm_statuses:Object.fromEntries(Object.entries(arms).map(([n,a])=>[n,a.result.status]))};
 const common=Math.min(...clocks),c=JSON.parse(cp.execFileSync('docker',['inspect','roi-close-atomic-test-20261003'],{encoding:'utf8'}))[0],e=Object.fromEntries(c.Config.Env.map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)]}));
 if(c.NetworkSettings.Ports['5432/tcp'][0].HostPort!=='55439')throw Error('isolated_only');
 const comparison={status:'matched_prefix_assessed',common_end:new Date(common).toISOString(),common_end_epoch:common,scope:'shared-engine development; modeled known-cost prefix, not all-cost economics or confirmation',economic_goal_proven:false,roi_stress:null,baseline_live_policy_A:'not_measured',independent_quality_fill_uplift:null,added_cohort_net_expectancy:null,incremental_infrastructure_cost_usd:null,arms:{}};
 for(const [name,a]of Object.entries(arms)){
  const schema=a.manifest.storage_schema;if(!/^engine_[a-zA-Z0-9_]+$/.test(schema))throw Error('isolated_schema_required');
  const u=new URL(`postgresql://${encodeURIComponent(e.POSTGRES_USER)}:${encodeURIComponent(e.POSTGRES_PASSWORD)}@127.0.0.1:55439/crypto_reset_test`);u.searchParams.set('schema',schema);u.searchParams.set('connection_limit','1');
  const db=new PrismaClient({datasources:{db:{url:u.toString()}}});let rows;try{await db.$executeRawUnsafe("SET statement_timeout='5s'");rows=await db.$queryRawUnsafe(`SELECT id,event_data FROM "${schema}".testnet_trade_events WHERE position_id=$1 AND event_type='portfolio_command_checkpoint' AND timestamp<=$2 ORDER BY timestamp DESC,id DESC LIMIT 1`,'pipeline_v3_kim_nghia',new Date(common));}finally{await db.$disconnect();}
  if(!rows.length)throw Error('no_completed_prefix_checkpoint:'+name);
  const checkpoint=JSON.parse(rows[0].event_data),exchange=checkpoint.external_after;if(!exchange||!Number.isFinite(exchange.equity))throw Error('checkpoint_exchange_equity_missing:'+name);
  const open=checkpoint.after.positions.filter(p=>p.status==='open');if(open.length&&checkpoint.at!==common)throw Error('open_mark_clock_not_aligned:'+name);
  const operating=[...(a.result.network_receipts??[]).filter(r=>r.at<=common).map(r=>({at:r.at,cost:r.response?.usage?.cost,basis:'new_reported'})),...(a.result.receipt_replays??[]).filter(r=>r.at<=common).map(r=>({at:r.at,cost:r.reported_cost,basis:'exact_input_reuse_original_reported'}))];
  const unknown=operating.filter(r=>!validCost(r.cost));const cost=unknown.length?null:operating.reduce((s,r)=>s+r.cost,0),capital=a.manifest.capital;
  const orders=new Map(exchange.orders.map(o=>[String(o.orderId),o]));const entryExecutions=exchange.fills.filter(f=>orders.get(String(f.orderId))?.intent==='OPEN');const entries=[...new Map(entryExecutions.map(f=>[String(f.orderId),f])).values()];
  const causal=(a.result.causal_inventory?.decisions??[]).filter(d=>d.at<=common&&d.result?.execution?.success);for(const d of causal)if(!d.setup_id||!d.result.execution.orderId||!d.result.execution.binanceOrderId)throw Error('causal_execution_lineage_missing:'+name);const filledCausal=causal.filter(d=>entries.some(f=>String(f.orderId)===String(d.result.execution.binanceOrderId)));const causalEntryOrderIds=[...new Set(filledCausal.map(d=>String(d.result.execution.binanceOrderId)))];
  comparison.arms[name]={terminal_status:a.result.status,terminal_export_complete:a.result.terminal_export_complete,checkpoint_event_id:rows[0].id,checkpoint_at:checkpoint.at,capital,marked_equity:exchange.equity,wallet:exchange.wallet,unrealized:exchange.unrealizedPnl,gross_marked_change:exchange.equity-capital,scoped_ai_operating_cost_usd:cost,scoped_ai_requests:operating.length,unknown_cost_requests:unknown.length,modeled_known_cost_net_usd:cost===null?null:exchange.equity-capital-cost,modeled_known_cost_roi_percent:cost===null?null:100*(exchange.equity-capital-cost)/capital,all_cost_roi_base:null,entry_fill_executions:entryExecutions.length,entry_order_ids:entries.map(f=>String(f.orderId)),entry_fills:entries.length,causal_entry_order_ids:causalEntryOrderIds,causal_entry_fills:causalEntryOrderIds.length,distinct_filled_causal_setup_ids:[...new Set(filledCausal.map(d=>d.setup_id))],independent_quality_clusters:null,closed_positions:checkpoint.after.positions.filter(p=>p.status==='closed'&&p.side!=='NONE').length,open_positions:open.length,open_quantity:exchange.quantity,pending_orders:checkpoint.after.pending.filter(p=>p.status==='pending').length,scoped_commissions_already_in_equity:exchange.fills.reduce((s,f)=>s+f.commission,0),scoped_funding_already_in_equity:exchange.funding.reduce((s,f)=>s+f.income,0),actual_new_reported_invoice_cost_entire_arm:a.result.new_reported_provider_cost_usd,cost_rule:'fee/funding already in exchange equity; subtract AI once, no second fee subtraction'};
 }
 const b=comparison.arms.baseline,d=comparison.arms.candidate;comparison.entry_fill_uplift=d.entry_fills-b.entry_fills;comparison.modeled_known_cost_net_uplift_usd=b.modeled_known_cost_net_usd===null||d.modeled_known_cost_net_usd===null?null:d.modeled_known_cost_net_usd-b.modeled_known_cost_net_usd;
 comparison.full_registered_window_completed=Object.values(arms).every(a=>a.result.status==='integration_window_completed'&&a.result.terminal_export_complete&&a.result.last_evaluated_at===Date.parse(a.manifest.end));
 const failureReasons=[];
 if(comparison.full_registered_window_completed){
  if(d.modeled_known_cost_net_usd!==null&&d.modeled_known_cost_net_usd<=0)failureReasons.push('candidate_known_cost_net_nonpositive');
  if(comparison.entry_fill_uplift<=0)failureReasons.push('candidate_unique_entry_orders_do_not_increase');
 }
 comparison.decision=failureReasons.length?'reject_registered_candidate':comparison.full_registered_window_completed?'economic_confirmation_insufficient':'partial_window_inconclusive';
 comparison.failure_reasons=failureReasons;
 comparison.promotion_allowed=false;
 comparison.needed=['actual execution/cost coverage and incremental infrastructure cost','independent quality cluster/added-cohort attribution','separate evolving-account stress replay','live-policy baselineA comparison','unseen/prospective confirmation and uncertainty'];
 return comparison;
}
if(require.main===module)assess().then(report=>{fs.writeFileSync(path.join(audit,'assessment.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}).catch(e=>{const report={status:'assessment_failed',failure:e.message,economic_goal_proven:false};fs.writeFileSync(path.join(audit,'assessment.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exitCode=1;});
module.exports={assess};

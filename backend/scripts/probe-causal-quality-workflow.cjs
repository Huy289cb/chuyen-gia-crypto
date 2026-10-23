'use strict';
// Registered zero-provider rejection probe. Uses the existing compiled coordinator/storage.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto'),ts=require('typescript');
const {PrismaClient}=require('@prisma/client');
const {createProductionPortfolioRuntime}=require('./production-portfolio-runtime.cjs');
const {createPortfolioCommandJournal}=require('./portfolio-command-journal-server-gap.cjs');
const root=path.resolve(__dirname,'../..'),audit=path.join(root,'docs/audits/2026-10-07-causal-quality'),out=path.join(audit,'workflow-probe');
if(fs.existsSync(out))throw Error('new_probe_directory_required');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p))),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const measurement=read('docs/audits/2026-10-07-causal-quality/measurement.json');
assert.equal(measurement.eligible_direct_prefix.length,0,'zero-provider rejection-only scope');
const container=JSON.parse(cp.execFileSync('docker',['inspect','roi-close-atomic-test-20261003'],{encoding:'utf8'}))[0];
assert.equal(container.NetworkSettings.Ports['5432/tcp'][0].HostPort,'55439');
assert.equal(container.NetworkSettings.Ports['5432/tcp'][0].HostIp,'127.0.0.1');
const vars=Object.fromEntries(container.Config.Env.filter(s=>s.includes('=')).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));
assert.equal(vars.POSTGRES_DB,'crypto_reset_test');
const schema='engine_causal_quality_20261007',url=new URL(`postgresql://${encodeURIComponent(vars.POSTGRES_USER??'postgres')}:${encodeURIComponent(vars.POSTGRES_PASSWORD)}@127.0.0.1:55439/crypto_reset_test`);url.searchParams.set('schema',schema);
fs.mkdirSync(out,{recursive:true,mode:0o700});
let db,runtime,at=Date.parse('2025-02-01T00:00:05Z');
const report={scope:'compiled shared producer→workflow→fresh causal gate rejection, one unchanged isolated account; not economic portfolio measurement',production_touched:false,provider_calls:0,orders:0,steps:[],passed:false};
(async()=>{
 const runtimeRoot=path.join(out,'runtime');
 fs.cpSync(path.join(root,'docs/audits/2026-10-04-causal-workflow-runtime/runtime'),runtimeRoot,{recursive:true});
 const overlays=['analyzers/causal-setup-gate.analyzer','analyzers/setup-gate.analyzer','analyzers/setup-gate.types','utils/causal-plan-evidence','utils/setup-gate-evidence','utils/setup-trade-side','services/signal-gate.service','services/groq-dispatch.service'];
 const sourceHashes={};
 for(const rel of overlays){const file=path.join(root,'backend/src',rel+'.ts'),source=fs.readFileSync(file,'utf8');sourceHashes[rel]=hash(file);
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true},reportDiagnostics:true});
  if(compiled.diagnostics.some(d=>d.category===ts.DiagnosticCategory.Error))throw Error('overlay_transpile_failed:'+rel);
  fs.writeFileSync(path.join(runtimeRoot,rel+'.js'),compiled.outputText);
 }
 const manifest={compilation:'isolated frozen runtime plus explicitly transpiled source overlays; focused semantic typecheck separate; not full build certification',source_hashes:sourceHashes,runtime_hashes:{}};
 function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.isDirectory())walk(p);else if(item.name.endsWith('.js'))manifest.runtime_hashes[path.relative(runtimeRoot,p)]=hash(p);}}walk(runtimeRoot);
 fs.writeFileSync(path.join(out,'runtime-manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
 const setup=cp.spawnSync(path.join(root,'backend/node_modules/.bin/prisma'),['db','push','--skip-generate'],{cwd:path.join(root,'backend'),env:{...process.env,DATABASE_URL:url.toString()},encoding:'utf8',timeout:60000});
 if(setup.status!==0)throw Error('isolated_schema_setup_failed');
 db=new PrismaClient({datasources:{db:{url:url.toString()}}});assert.equal(await db.testnetAccount.count(),0,'fresh isolated namespace required');
 const account=await db.testnetAccount.create({data:{symbol:'BTC',method_id:'kim_nghia',starting_balance:31.47744546,current_balance:31.47744546,equity:31.47744546,created_at:new Date(at),updated_at:new Date(at)}});
 const journal=createPortfolioCommandJournal({database:db,positionId:'pipeline_v3_kim_nghia',storageSchema:schema});
 const environment={...read('docs/audits/2026-10-04-continuous-causal-portfolio/policy.json').environment,CAUSAL_OPPORTUNITY_RESEARCH_ENABLED:'true',CAUSAL_SETUP_SCORING_VERSION:'rejection-volume-v1'};
 const adapterNames=JSON.parse(fs.readFileSync(path.join(__dirname,'production-portfolio-runtime.cjs'),'utf8').match(/const externalModules=new Set\((\[[^;]+\])\)/)[1].replace(/'/g,'"'));
 const adapters=Object.fromEntries(adapterNames.map(name=>[name,new Proxy({}, {get:(_t,key)=>key==='__esModule'?true:()=>{throw Error('unexpected_rejection_probe_dependency:'+name+':'+String(key));}})]));
 let scans={};adapters['schedulers/market-scan.scheduler']={getScanResult:(_symbol,tf)=>scans[tf]};
 runtime=createProductionPortfolioRuntime({runtimeRoot,database:db,environment,externalAdapters:adapters,initialClock:at,commandJournal:journal});
 await runtime.load('repositories/testnet.repository').ensurePipelineEventPosition(account.id);await journal.prepare();
 const initial=await runtime.snapshot();
 const data=read('docs/audits/2026-09-11-opportunity-testbed/train-data.json');
 const durations={hour:3600000,five:300000,fifteen:900000,fourHour:14400000},tfs={hour:'1h',five:'5m',fifteen:'15m',fourHour:'4h'};
 const series=Object.fromEntries(Object.entries(tfs).map(([key,tf])=>[key,data.byTf[tf].map(b=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}))]));
 const cursors=Object.fromEntries(Object.keys(tfs).map(k=>[k,0]));
 function barsAt(clock){return Object.fromEntries(Object.entries(durations).map(([key,d])=>{const all=series[key];while(cursors[key]<all.length&&all[cursors[key]].timestamp+d+5000<=clock)cursors[key]++;const n=key==='hour'?104:key==='fourHour'?cursors[key]:100;return[key,all.slice(Math.max(0,cursors[key]-n),cursors[key])];}));}
 const producer=runtime.load('services/causal-opportunity-inventory.service'),analyzer=runtime.load('analyzers/setup-gate.analyzer');
 let state=producer.emptyCausalInventory(),observed=0,resolvedPlans=0;const observedIds=new Set(),planIds=new Set();
 const start=Date.parse('2025-02-01T00:00:05Z'),end=Date.parse('2025-03-01T00:00:05Z');
 for(let clock=Date.parse('2025-01-15T00:00:05Z');clock<end;clock+=300000){
  const bars=barsAt(clock),step=producer.advanceCausalInventory({state,at:clock,bars});state=step.state;
  for(const event of step.events){
   if(clock<start||event.row.candidate.knownAt<start)continue;
   if(event.kind==='observed'){observed++;observedIds.add(event.row.candidate.id);continue;}
   if(event.outcome?.status!=='plan')continue;
   resolvedPlans++;planIds.add(event.row.candidate.id);at=clock;
   const c=event.row.candidate,p=event.outcome,tf=event.row.mechanism==='H1'?'15m':'5m',child=tf==='15m'?'fifteen':'five';
   const plan=runtime.load('utils/causal-plan-contract').sealCausalPlan({version:'h1-h2-review-v1',setupId:c.id,mechanism:event.row.mechanism,symbol:'BTC',timeframe:tf,side:c.side,knownAt:c.knownAt,expiresAt:c.expiresAt,entry:p.entry,stop:c.side==='long'?Math.floor(p.stop*10)/10:Math.ceil(p.stop*10)/10,target:p.target,invalidation:p.invalidation,minRr:1.5});
   for(const [htf,key]of [['1h','hour'],['4h','fourHour']]){const result=await analyzer.analyzeSetupGate({symbol:'BTC',timeframe:htf,candles:bars[key].slice(-100)});scans[htf]={timestamp:new Date(at),signalResult:{setupResult:result,gateRegime:result.regime}};}
   const result=await runtime.step({kind:'causal_review',at,input:{symbol:'BTC',timeframe:tf,causalPlan:plan,causalEvidence:{at,bars},candles:bars[child],systemPrompt:runtime.load('config/methods').getMethodConfig('kim_nghia').systemPrompt}});
   assert.equal(result.result.decision,'no_trade');assert.match(result.result.reason,/Signal gate blocked/);assert(!result.result.execution);
   report.steps.push({setup_id:c.id,at,mechanism:event.row.mechanism,result:result.result});
  }
 }
 assert.equal(observed,121);assert.equal(observedIds.size,121);assert.equal(resolvedPlans,67);assert.equal(planIds.size,67);
 assert.deepEqual([...planIds].sort(),measurement.rows.map(r=>r.setup_id).sort());
 const terminal=await runtime.snapshot();assert.deepEqual(terminal.accounts,initial.accounts);assert.equal(await db.testnetPendingOrder.count(),0);assert.equal(await db.tradeDecision.count(),0);
 const durable=await journal.recoverCausalInventory(at);assert.equal(durable.attemptedSetupIds.length,67);
 report.diagnostics=runtime.diagnostics();assert.deepEqual(report.diagnostics.database_errors,[]);assert.deepEqual(report.diagnostics.adapter_failures,[]);
 for(const [f,h]of Object.entries(manifest.runtime_hashes))assert.equal(hash(path.join(runtimeRoot,f)),h);
 report.inventory={observed,plans:resolvedPlans,attempted_durable:durable.attemptedSetupIds.length};report.initial_account=initial.accounts;report.terminal_account=terminal.accounts;report.passed=true;
})().catch(e=>{report.failure=e.message;process.exitCode=1;}).finally(async()=>{if(runtime)report.diagnostics=runtime.diagnostics();if(db)await db.$disconnect();fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,inventory:report.inventory,failure:report.failure}));});

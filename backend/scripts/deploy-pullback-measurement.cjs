// Applies an allowlisted sealed overlay after a flat-account check; keeps PM2 env.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),pkg=path.resolve(process.argv[2]||''),out=path.resolve(process.argv[3]||'');
if(!process.argv[2]||!process.argv[3]||fs.existsSync(out))throw Error('Usage: PACKAGE NEW_REPORT');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const pm2=(...args)=>cp.execFileSync('pm2',args,{encoding:'utf8',timeout:45000});
const apps=JSON.parse(pm2('jlist')),names=['crypto-api','crypto-worker','crypto-post-exit'];
const selected=names.map(n=>apps.find(a=>a.name===n));
if(selected.some(a=>!a?.pid||a.pm2_env.status!=='online'))throw Error('apps_not_online');
const envFor=a=>Object.fromEntries(fs.readFileSync('/proc/'+a.pid+'/environ','utf8').split('\0').filter(Boolean).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));
const envs=selected.map(envFor),workerEnv=envs[1];Object.assign(process.env,workerEnv);
// PM2's IPC descriptor belongs to the worker, not these standalone child processes.
for(const key of ['NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE','NODE_UNIQUE_ID'])delete process.env[key];
const pinned={MAX_EFFECTIVE_RISK_PER_TRADE_USD:'',MAX_EFFECTIVE_RISK_PER_TRADE_PERCENT:'3',DAILY_LOSS_LIMIT_PERCENT:'10',MIN_SL_DISTANCE_PERCENT:'0.008',RISK_PER_TRADE_PERCENT:'0.5',MAX_TOTAL_EXPOSURE_USD:'100',POST_CLOSE_SAME_SIDE_COOLDOWN_MINUTES:'60',POST_LOSS_SAME_SIDE_COOLDOWN_MINUTES:'60',PENDING_ORDER_REENTRY_COOLDOWN_MINUTES:'60',CONSECUTIVE_LOSS_COOLDOWN_HOURS:'1',LOSS_COOLDOWN_TIER2_HOURS:'1',LOSS_COOLDOWN_TIER3_HOURS:'1',LOSS_COOLDOWN_TIER3_UNTIL_UTC_DAY:'false',CIRCUIT_EXPECTANCY_COOLDOWN_HOURS:'1'};
for(const env of envs.slice(0,2))for(const [k,v]of Object.entries(pinned))if(env[k]!==v)throw Error('policy_mismatch:'+k);
const target=path.join(root,'dist');
if(selected.some(a=>path.dirname(a.pm2_env.pm_exec_path)!==target))throw Error('unexpected_entrypoint');
const manifest=JSON.parse(fs.readFileSync(path.join(pkg,'manifest.json')));
const releaseKind=process.argv[4]??'pullback-measurement';
const allowedFiles={'pre-ai-input':['services/groq-dispatch.service.js','utils/entry-feasibility-observation.js'],
 'atomic-close-lineage':['services/binance-fill-pnl.service.js','services/position-close.service.js','utils/atomic-verified-close.js','utils/close-account-update.js','utils/close-round-match.js','utils/recorded-close-account.js','utils/recorded-close-round.js'],
 'entry-price-feasibility':['services/v3-trade-execution.service.js','utils/entry-price-feasibility.js'],
 'target-sizing':['services/v3-trade-execution.service.js','utils/target-risk-sizing.js'],
 'entry-occupancy':['services/v3-trade-execution.service.js','utils/entry-occupancy-evaluation.js'],
 'entry-history-cooldown':['services/v3-entry-eligibility.service.js','utils/entry-history-cooldown-evaluation.js'],
 'symbol-exposure':['services/v3-entry-eligibility.service.js','utils/exposure-observation-publish.js','utils/symbol-exposure-evaluation.js'],
 'position-reduction':['schedulers/position-monitor.scheduler.js','utils/position-reduction-write-observation.js'],
 'pending-close-receipts':['services/position-close.service.js','services/v3-trade-execution.service.js','utils/pending-create-observation.js','utils/position-close-write-observation.js'],
 'materialization':['services/binance-order-fill.service.js','utils/fill-materialization-gate.js','utils/materialization-write-observation.js','utils/recorded-materialization-gate.js'],
 'guard-invocation':['services/account-risk-guard.service.js','utils/account-guard-completion.js','utils/account-guard-invocation.js','utils/entry-trace.js'],
 'account-completion':['services/account-risk-guard.service.js','utils/account-guard-completion.js'],
 'loss-streak-decision':['services/account-risk-guard.service.js','utils/loss-streak-cooldown-decision.js'],
 'circuit-decision':['services/account-circuit.service.js','utils/account-circuit-evaluation.js','utils/recorded-account-circuit-decision.js'],
 'account-initial-decision':['services/account-risk-guard.service.js','utils/recorded-account-initial-decision.js'],
 'provider-journal':['repositories/provider-journal.repository.js','services/llm-telemetry.service.js','utils/provider-journal-record.js'],
 'provider-aux-purpose':['services/ai-opportunity-provider.js','services/telegram/telegram-ai.service.js'],
 'provider-primary-purpose':['services/groq-dispatch.service.js','services/groq-levels-adapter.service.js','services/opposite-flip.service.js'],
 'provider-purpose':['services/openrouter-shadow.service.js','services/pending-order-review.service.js','utils/provider-purpose-context.js','utils/provider-request-context.js'],
 'provider-context':['services/llm-telemetry.service.js','utils/provider-request-context.js'],
 'telemetry-null':['services/llm-telemetry.service.js'],
 'reset-journal':['repositories/account-mutation-journal.repository.js','routes/testnet.js','utils/account-reset-receipt.js','utils/account-reset-update.js','utils/recorded-account-reset.js'],
 'manual-close':['routes/testnet.js','utils/manual-close-account-update.js','utils/recorded-manual-close.js'],
 'backfill-journal':['services/position-pnl-backfill.service.js','utils/backfill-account-statistics.js','utils/backfill-row-evidence.js','utils/recorded-backfill-statistics.js'],
 'capital-sync':['routes/testnet.js','utils/recorded-starting-balance.js','utils/starting-balance-update.js'],
 'precision-reset':['repositories/testnet.repository.js','utils/precision-reset-update.js','utils/recorded-precision-reset.js'],
 'circuit-journal':['services/account-circuit.service.js','utils/account-drawdown-percent.js','utils/recorded-account-circuit-mutation.js'],
 'cooldown-set':['repositories/testnet.repository.js','utils/recorded-account-cooldown-set.js'],
 'account-guard':['services/account-risk-guard.service.js','utils/account-initial-guard.js','utils/recorded-account-guard-mutation.js'],
 'structure-permission':['services/groq-dispatch.service.js','utils/recorded-structure-permission.js'],
 'net-statistics':['services/position-pnl-reconcile.service.js','utils/net-trade-statistics.js','utils/recorded-net-statistics.js'],
 'wallet-reconcile':['services/wallet-reconcile.service.js','utils/account-wallet-journal.js','utils/recorded-wallet-reconcile.js','utils/wallet-reconcile-update.js'],
 'account-wallet':['services/binance-balance-sync.service.js','utils/account-wallet-journal.js','utils/recorded-account-wallet.js'],
 'account-clock':['services/position-close.service.js','utils/recorded-close-account.js'],
 'wallet-sync':['services/binance-balance-sync.service.js','services/position-close.service.js','utils/recorded-wallet-sync.js','utils/wallet-sync-update.js'],
 'round-query':['services/binance-fill-pnl.service.js','services/position-close.service.js','utils/close-round-match.js','utils/recorded-close-round.js'],
 'close-account':['services/position-close.service.js','utils/close-account-update.js','utils/recorded-close-account.js'],
 'algo-evidence':['services/binance/trading.js','services/protective-order.service.js','utils/algo-contract-evidence.js'],
 'protection-action':['services/protective-order.service.js','utils/protective-action.js','utils/recorded-protective-action.js'],
 'partial-journal':['services/binance-order-fill.service.js','utils/partial-fill-evidence.js'],
 'pending-journal':['services/pending-order-actions.js','utils/pending-cancel-transition.js'],
 'shared-admission':['services/v3-trade-execution.service.js','utils/post-quantity-admission.js','utils/recorded-post-quantity.js'],
 'setup-anchor-evidence':['utils/setup-identity.js'],
 'setup-measurement':['analyzers/breakout-volume.analyzer.js','analyzers/liquidity-sweep.analyzer.js','services/account-risk-guard.service.js','services/entry-gate-funnel.service.js','services/groq-dispatch.service.js','utils/closed-candles.js','utils/setup-identity.js'],
 'pullback-measurement':['services/groq-dispatch.service.js','utils/pullback-evaluation.js'],
 'admission-measurement':['services/v3-trade-execution.service.js'],
 'cancel-ack':['services/binance/trading.js','services/pending-order-actions.js'],
 'partial-terminal':['services/binance-order-fill.service.js','services/binance-websocket-sync.js'],
 'active-partial':['services/binance-order-fill.service.js','services/binance-reconciliation.js','services/binance-websocket-sync.js','services/binance/trading.js'],
 'protective-ack':['services/protective-order.service.js'],
 'protective-repair':['services/protective-order.service.d.ts','services/protective-order.service.js']}[releaseKind];
if(!allowedFiles||JSON.stringify([...manifest.changedFiles].sort())!==JSON.stringify(allowedFiles))throw Error('unexpected_overlay');
if(releaseKind==='active-partial' &&
 (selected[1].pm2_env.exec_mode!=='fork_mode' || Number(selected[1].pm2_env.instances||1)!==1 ||
  apps.filter(a=>a.name==='crypto-worker').length!==1 ||
  envs[0].BINANCE_USER_STREAM_ON_WORKER==='false' || workerEnv.BINANCE_USER_STREAM_ON_WORKER==='false')) {
 throw Error('partial_recovery_requires_single_worker_stream_owner');
}
const control=command=>cp.execFileSync('python3',[path.join(__dirname,'measurement-release-control.py'),command,'--package',pkg,...(['apply','rollback'].includes(command)?['--target',target]:[])],{encoding:'utf8',timeout:45000});
control('verify');
if(releaseKind==='pre-ai-input'){
 if(manifest.outsidePatchByteParity!==true||manifest.environmentChanges!==false||
    !Object.entries(manifest.sourceHashes).every(([file,hash])=>sha(fs.readFileSync(path.join(root,file)))===hash))throw Error('pre_ai_source_package_mismatch');
 const result=JSON.parse(cp.execFileSync(process.execPath,[path.join(__dirname,'test-pre-ai-input-replay.cjs'),pkg],{cwd:root,encoding:'utf8',timeout:30000}));
 if(result.cases!==18||!result.actualDeployedStageAndDiagnosticCompared||!result.sealedCompiledStageCompared||!result.environmentIndependentReplay||!result.corruptionMissingGraceAndFutureRejected||!result.noNetworkOrDatabase)throw Error('pre_ai_replay_proof_missing');
 cp.execFileSync('python3',[path.join(__dirname,'measurement-release-control.py'),'preflight','--package',pkg,'--target',target],{encoding:'utf8',timeout:45000});
}
if(releaseKind==='atomic-close-lineage'){
 const proof=JSON.parse(fs.readFileSync(path.join(pkg,'compiled-atomic-close-postgres-proof-v2.json'))),legacy=JSON.parse(fs.readFileSync(path.join(pkg,'atomic-close-legacy-decoder-proof-v1.json')));
 if(!manifest.outsidePatchByteParity||manifest.environmentChanges!==false||!Object.entries(manifest.sourceHashes).every(([file,hash])=>sha(fs.readFileSync(file))===hash))throw Error('atomic_source_package_mismatch');
 if(proof.compiledFillAndCloseHandlerWithRealIsolatedPrisma!==true||proof.productionTouched!==false||proof.cases!==5||proof.results.length!==5||!proof.results.every(r=>r.trades===1&&r.atomic_receipts===1&&Math.abs(r.net-14.8)<1e-8))throw Error('atomic_postgres_proof_missing');
 if(legacy.legacyCompiledCases!==16||!legacy.cases.every(r=>r.parity===true)||legacy.decoderComparisons!==45||legacy.valid!==10||legacy.rejected!==35||legacy.productionTouched!==false)throw Error('atomic_legacy_decoder_proof_missing');
}
const {get}=require(path.join(target,'services/binance/client'));
const {endpoints}=require(path.join(target,'services/binance/endpoints'));
const {prisma}=require(path.join(target,'lib/prisma'));
const report={startedAt:new Date().toISOString(),releaseKind,policy:pinned,package:pkg,packageManifestSha256:sha(fs.readFileSync(path.join(pkg,'manifest.json'))),deployed:false};
let stopped=false,applied=false;
async function flat(){
 const [positions,orders,algo]=await Promise.all([get('/fapi/v2/positionRisk',{symbol:'BTCUSDT'},true),get('/fapi/v1/openOrders',{symbol:'BTCUSDT'},true),get(endpoints.OPEN_ALGO_ORDERS,{symbol:'BTCUSDT'},true)]);
 const algos=Array.isArray(algo)?algo:algo?.orders;
 if(!Array.isArray(positions)||!Array.isArray(orders)||!Array.isArray(algos))throw Error('unknown_exchange_state');
 const count=positions.filter(p=>p.symbol==='BTCUSDT'&&Number(p.positionAmt)!==0).length;
 if(count||orders.length||algos.length)throw Error('account_not_flat');
 const [dbPositions,dbPending]=await Promise.all([
  prisma.testnetPosition.count({where:{symbol:'BTC',status:{in:['open','reconciliation_failed_not_on_binance']}}}),
  prisma.testnetPendingOrder.count({where:{symbol:'BTC',status:{in:['pending','partially_filled','reconciliation_failed_not_on_binance']}}}),
 ]);
 if(dbPositions||dbPending)throw Error('database_not_flat');
 return {checkedAt:new Date().toISOString(),positions:count,orders:orders.length,algoOrders:algos.length};
}
(async()=>{
 if(releaseKind==='provider-journal')await require('./verify-provider-journal-schema.cjs').verifyProviderJournalSchema(prisma);
 if(releaseKind==='reset-journal')await require('./verify-reset-journal-schema.cjs').verifyResetJournalSchema(prisma);
 report.before=await flat();
 pm2('stop',...names);stopped=true;
 report.stoppedState=await flat();
 report.apply=JSON.parse(control('apply'));applied=true;
 pm2('restart',...names);stopped=false;
 const after=JSON.parse(pm2('jlist'));
 for(let i=0;i<names.length;i++){
  const a=after.find(a=>a.name===names[i]);if(!a?.pid||a.pm2_env.status!=='online')throw Error('restart_failed');
  const env=envFor(a);for(const [k,v]of Object.entries(pinned))if(i<2&&env[k]!==v)throw Error('post_policy_mismatch');
 }
 report.deployed=true;report.completedAt=new Date().toISOString();
 report.apps=after.filter(a=>names.includes(a.name)).map(a=>({name:a.name,pid:a.pid,status:a.pm2_env.status}));
 pm2('save');
})().catch(error=>{
 report.error=error.message?.startsWith('Command failed')?'deployment_command_failed':error.message;
 if(applied){pm2('stop',...names);stopped=true;report.rollback=JSON.parse(control('rollback'));}
 if(stopped){pm2('restart',...names);stopped=false;}
 process.exitCode=1;
}).finally(async()=>{await prisma.$disconnect();fs.writeFileSync(out,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({deployed:report.deployed,error:report.error,report:out}));});

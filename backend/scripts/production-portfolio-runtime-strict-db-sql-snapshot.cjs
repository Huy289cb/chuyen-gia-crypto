'use strict';
// Runs the deployed handlers with a supplied clock/storage/exchange boundary.
// Strict database boundary v1: a separate version; the original runtime stays frozen.
// This is an execution adapter, never an alternate trading simulator.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const coreServices=new Set(['causal-opportunity-workflow.service','causal-opportunity-inventory.service','wallet-reconcile.service','position-pnl-reconcile.service','binance-income.service','binance/endpoints','open-entry-fee-reconcile.service','position-mark','profit-protect.service','position-invalidation.service','amend-protective-sl.service','openrouter-shadow.service','groq-client','openrouter-client','cerebras-client','llm-telemetry.service','memory.service','binance-trade-history.service','entry-gate-funnel.service','ict-shadow-funnel.service','pending-order-lifecycle.service','pending-order-review.service','ai-opportunity-runtime','ai-opportunity-review.service','ai-opportunity-provider','transition-breakout-retest.service','groq-dispatch.service','groq-levels-adapter.service','signal-gate.service','risk-manager.service','v3-trade-execution.service','opposite-flip.service','v3-entry-eligibility.service','account-risk-guard.service','account-circuit.service','account-performance.service','expectancy-rollup.service','binance-order-fill.service','position-close.service','binance-fill-pnl.service','pending-order-actions','binance-balance-sync.service','close-reason-resolve.service','trade-outcome.service','protective-order.service','protective-exposure-state']);
const externalModules=new Set(['services/binance/client','services/price-fetcher','services/llm-telemetry.service','services/groq-client','services/openrouter-client','services/candle.service','services/binance/market','services/openrouter-shadow.service','schedulers/market-scan.scheduler','services/binanceClient','services/binance-hedge-mode','services/binance-account-health.service','services/binance-exposure.service','services/binance-trade-history.service','services/binance-income.service','services/binance/trading','services/binance/account','services/telegram/telegram-hooks','services/telegram/telegram-notify.service','services/memory.service']);
function createProductionPortfolioRuntime({runtimeRoot,database,environment,externalAdapters,initialClock,readClock,checkpointWriter,externalStateSnapshot,commandJournal,storageSchema}){
 if(!database||typeof database.$transaction!=='function')throw Error('explicit_storage_adapter_required');
 if(!Number.isFinite(initialClock))throw Error('explicit_clock_required');
 if(checkpointWriter&&commandJournal)throw Error('one_checkpoint_writer_required');const checkpointEnabled=!!(checkpointWriter||commandJournal);
 const root=fs.realpathSync(runtimeRoot),env=Object.freeze({...environment}),adapters=externalAdapters??{},modules=new Map(),loaded={},unavailable=new Set(),effects=[],pending=new Set(),dbErrors=[],providerErrors=[],adapterFailures=[];
 let clock=initialClock,lastObservedClock=initialClock,busy=false,commandSequence=0,activeAudit=null,checkpointFailure=null,activeCommand=null,databaseBoundaryFailure=null;
 const now=()=>{const at=readClock?readClock(clock):clock;if(!Number.isFinite(at)||at<clock||at<lastObservedClock)throw Error('invalid_runtime_clock_adapter');lastObservedClock=at;return at;};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now()]));}static now(){return now();}}
 const databaseContext=()=>({at:clock,command_sequence:activeCommand?.sequence??commandSequence,command_kind:activeCommand?.kind??null});
 function recordDatabaseFailure(error,context){const failure={message:error.message,code:error.code??null,...context};dbErrors.push(failure);databaseBoundaryFailure??={...failure};}
 const track=(p,kind='database',context=databaseContext())=>{if(!p||typeof p.then!=='function')return p;pending.add(p);p.then(()=>pending.delete(p),error=>{pending.delete(p);if(kind==='provider')providerErrors.push({message:error.message});else recordDatabaseFailure(error,context);});return p;};
 function invokeDatabase(work){const context=databaseContext();try{return track(work(),'database',context);}catch(error){recordDatabaseFailure(error,context);throw error;}}
 function assertDatabaseBoundary(){if(databaseBoundaryFailure||dbErrors.length){const error=Error('runtime_database_integrity_failure');error.code='REPLAY_DATABASE_INTEGRITY';throw error;}}
 const modelClockFields=Object.fromEntries(Object.entries(database._runtimeDataModel?.models??{}).map(([name,model])=>[name[0].toLowerCase()+name.slice(1),model.fields.filter(f=>f.type==='DateTime'&&(f.default?.name==='now'||f.isUpdatedAt)).map(f=>({name:f.name,onUpdate:!!f.isUpdatedAt}))]));
 function clockData(data,fields,update=false){if(!data)return data;const result={...data};for(const field of fields??[])if((!update||field.onUpdate)&&result[field.name]===undefined)result[field.name]=new Clock();return result;}
 function clockWrite(key,method,args){const fields=modelClockFields[key];if(!fields?.length||!args[0])return args;const input={...args[0]};if(method==='create'||method==='update'||method==='updateMany')input.data=clockData(input.data,fields,method!=='create');else if(method==='createMany')input.data=Array.isArray(input.data)?input.data.map(d=>clockData(d,fields)):clockData(input.data,fields);else if(method==='upsert'){input.create=clockData(input.create,fields);input.update=clockData(input.update,fields,true);}return[input,...args.slice(1)];}
 function wrapDb(db,transactionId=null){return new Proxy(db,{get(target,key){if(key==='$transaction')return work=>{const audit=activeAudit;const transaction=audit?{id:audit.transactions.length,status:'pending',started_at:now()}:null;if(transaction)audit.transactions.push(transaction);const promise=invokeDatabase(()=>target.$transaction(tx=>work(wrapDb(tx,transaction?.id??null))));if(transaction)promise.then(()=>{transaction.status='committed';transaction.completed_sequence=audit.completionCount++;transaction.completed_at=now();},error=>{transaction.status='rolled_back';transaction.error=error.message;transaction.completed_sequence=audit.completionCount++;transaction.completed_at=now();});return promise;};const model=target[key];if(model&&typeof model==='object')return new Proxy(model,{get(model,method){const fn=model[method];return typeof fn==='function'?(...args)=>{const audit=activeAudit;const observed=['testnetAccount','testnetPosition','testnetPendingOrder','tradeDecision'].includes(key)&&audit;const item=observed?{sequence:audit.length,transaction_id:transactionId,model:key,method:String(method),at:now(),args:JSON.parse(JSON.stringify(args))}:null;if(item)audit.push(item);const promise=invokeDatabase(()=>fn.apply(model,clockWrite(key,method,args)));if(item)promise.then(value=>{item.result=JSON.parse(JSON.stringify(value??null));item.completed_sequence=audit.completionCount++;item.completed_at=now();},error=>{item.error=error.message;item.completed_sequence=audit.completionCount++;item.completed_at=now();});return promise;}:fn;}});return typeof model==='function'?(...args)=>invokeDatabase(()=>model.apply(target,args)):model;}});}
 const db=wrapDb(database);
 const missingModule=rel=>{unavailable.add(rel);adapterFailures.push({module:rel,member:null,reason:'module_unavailable'});return new Proxy({}, {get(_target,key){if(key==='__esModule'||key==='then')return undefined;adapterFailures.push({module:rel,member:String(key)});throw Error('unavailable_replay_dependency:'+rel+':'+String(key));}});};
 function load(relative){
  const rel=relative.replace(/\.js$/,'');if(modules.has(rel))return modules.get(rel).exports;
  if(rel==='lib/prisma')return {prisma:db};
  if(externalModules.has(rel)&&!(['schedulers/market-scan.scheduler','services/binance-trade-history.service','services/binance-income.service','services/memory.service','services/groq-client','services/openrouter-client','services/llm-telemetry.service','services/openrouter-shadow.service'].includes(rel)&&!Object.hasOwn(adapters,rel))){
   if(!Object.hasOwn(adapters,rel))return missingModule(rel);
   return new Proxy(adapters[rel],{get(target,key){if(key==='__esModule'||key==='then')return target[key];if(!Object.hasOwn(target,key)){adapterFailures.push({module:rel,member:String(key)});throw Error('missing_external_adapter:'+rel+':'+String(key));}return target[key];}});
  }
  const allowed=rel.startsWith('utils/')||rel.startsWith('analyzers/')||rel.startsWith('config/')||['repositories/testnet.repository','repositories/market.repository','repositories/ai-opportunity.repository','repositories/memory.repository','repositories/trade.repository','repositories/provider-journal.repository','schedulers/llm-dispatch.scheduler','schedulers/market-scan.scheduler','schedulers/position-monitor.scheduler'].includes(rel)||rel.startsWith('services/')&&coreServices.has(rel.slice(9));
  if(!allowed)return missingModule(rel);
  const file=path.resolve(root,rel+'.js');if(!file.startsWith(root+path.sep))throw Error('runtime_path_escape');
  const bytes=fs.readFileSync(file);loaded[rel+'.js']=crypto.createHash('sha256').update(bytes).digest('hex');
  const mod={exports:{}};modules.set(rel,mod);
  const localRequire=id=>{
   if(id==='node-cron')return {schedule:()=>{throw Error('cron_start_forbidden_in_replay');}};
   if(['node:crypto','node:async_hooks','node:path','path','node:fs','fs'].includes(id))return require(id);
   if(!id.startsWith('.'))throw Error('external_import_denied:'+id);
   const target=path.relative(root,path.resolve(path.dirname(file),id)).split(path.sep).join('/');return load(target);
  };
  vm.runInNewContext(bytes.toString(),{module:mod,exports:mod.exports,require:localRequire,__filename:file,__dirname:path.dirname(file),process:{env,pid:process.pid},Date:Clock,console:{log:(...args)=>effects.push({kind:'log',args}),warn:(...args)=>effects.push({kind:'warn',args}),error:(...args)=>effects.push({kind:'error',args})},setTimeout,clearTimeout,Buffer,URL,URLSearchParams,AbortController,AbortSignal,fetch:(...args)=>{if(typeof adapters.providerFetch!=='function')throw Error('explicit_provider_fetch_required');return track(adapters.providerFetch(...args),'provider');}},{filename:file});
  // Protection submission is an explicit adapter boundary; level resolution stays production.
  if(rel==='services/protective-order.service'&&Object.hasOwn(adapters,'protection'))mod.exports.placeProtectiveOrdersForPosition=adapters.protection.placeProtectiveOrdersForPosition;
  return mod.exports;
 }
 async function flush(){for(let i=0;i<100;i++){for(let n=0;n<8;n++)await Promise.resolve();if(!pending.size)return;await Promise.allSettled([...pending]);}throw Error('unsettled_replay_database_work');}
 const readSnapshot=require('./isolated-sql-snapshot.cjs').createSqlSnapshot({database,storageSchema});
 async function snapshot(){await flush();return invokeDatabase(()=>readSnapshot(new Clock().toISOString()));}
 async function step(command){
  assertDatabaseBoundary();
  if(checkpointFailure)throw Error('checkpoint_persistence_or_command_gap');
  if(busy)throw Error('parallel_replay_commands_not_supported');
  if(!Number.isFinite(command.at)||command.at<lastObservedClock)throw Error('nonmonotonic_replay_clock');clock=command.at;busy=true;
  try{
   const sequence=++commandSequence;activeCommand={sequence,kind:command.kind,at:command.at};
   const before=checkpointEnabled?await snapshot():null;const externalBefore=checkpointEnabled&&externalStateSnapshot?JSON.parse(JSON.stringify(await externalStateSnapshot())):null;activeAudit=checkpointEnabled?[]:null;if(activeAudit){activeAudit.transactions=[];activeAudit.completionCount=0;}const commandKey=commandJournal?await commandJournal.begin({sequence,kind:command.kind,at:command.at,before,external_before:externalBefore,input_decision_id:command.input?.decisionRecordId??null,...(command.kind==='causal_review'?{causal_setup_id:command.input?.causalPlan?.setupId??null,causal_plan_hash:command.input?.causalPlan?.hash??null,causal_plan:command.input?.causalPlan??null}:{}),order_id:command.orderId??null,position_id:command.positionId??null}):null;
   let result;
   switch(command.kind){
    case 'balance_sync':result=await load('services/binance-balance-sync.service').syncAllTestnetAccountsFromBinance();break;
    case 'monitor':result=await load('schedulers/position-monitor.scheduler').runManualPositionMonitor();break;
    case 'market_scan':result=await load('schedulers/market-scan.scheduler').runManualMarketScan();break;
    case 'scheduler':result=await load('schedulers/llm-dispatch.scheduler').runManualLLMDispatch();break;
    case 'dispatch':result=await new (load('services/groq-dispatch.service').GroqDispatchService)(command.config).dispatch(command.input);break;
    case 'eligibility':result=await load('services/v3-entry-eligibility.service').canRunLlmDispatchForSymbol(command.symbol,command.methodId);break;
    case 'causal_review':result=await load('services/causal-opportunity-workflow.service').reviewAndExecuteCausalPlan(command.input);break;
    case 'causal_inventory':result=load('services/causal-opportunity-inventory.service').advanceCausalInventory({...command.input,at:clock});break;
    case 'execute':result=await load('services/v3-trade-execution.service').executeV3Trade(command.input);break;
    case 'fill':{const order=await db.testnetPendingOrder.findUnique({where:{order_id:command.orderId}});if(!order)throw Error('missing_pending_for_fill');result=await load('services/binance-order-fill.service').materializePositionFromPendingFill(order,command.executedQty,command.avgPrice,command.eventTime??clock,{suppressTelegram:true});break;}
    case 'cancel':{const order=await db.testnetPendingOrder.findUnique({where:{order_id:command.orderId}});if(!order)throw Error('missing_pending_for_cancel');result=await load('services/pending-order-actions').cancelPendingOnExchangeAndDb(order,command.reason);break;}
    case 'close':{const position=await db.testnetPosition.findUnique({where:{position_id:command.positionId},include:{account:true}});if(!position)throw Error('missing_position_for_close');result=await load('services/position-close.service').closeLocalPosition(position,command.price,command.reason,command.eventMeta);break;}
    case 'guard':result=await load('services/account-risk-guard.service').assertTestnetAccountCanOpenTrade(command.accountId,command.symbol);break;
    default:throw Error('unsupported_replay_command:'+command.kind);
   }
   const state=await snapshot();assertDatabaseBoundary();const audit=activeAudit;activeAudit=null;if(adapterFailures.length)throw Error('incomplete_external_adapter_boundary');if(checkpointEnabled){const checkpoint={command_key:commandKey,schema:'portfolio-command-checkpoint-v1',sequence,kind:command.kind,at:command.at,before,after:state,...(command.kind==='causal_inventory'?{causal_inventory:result}:command.kind==='causal_review'?{causal_review:result}:{}),external_before:externalBefore,external_after:externalStateSnapshot?JSON.parse(JSON.stringify(await externalStateSnapshot())):null,operations:audit,transactions:audit?.transactions??[],scope:'serialized command boundaries and recorded actual ORM reads/writes; not atomic external tick state'};if(commandJournal)await commandJournal.complete(checkpoint);else await checkpointWriter(checkpoint);}return {kind:command.kind,result,state};
  }catch(error){if(checkpointEnabled)checkpointFailure={command_sequence:commandSequence,error:error.message,at:clock};throw error;}finally{activeAudit=null;activeCommand=null;busy=false;}
 }
 return {step,snapshot,flush,load,diagnostics:()=>({schema:'production-portfolio-runtime-strict-db-sql-snapshot-v1',clock_adapter:readClock?'explicit_supplied_clock':'fixed_command_clock_coarse_intervals_may_be_ambiguous',loaded_runtime_hashes:{...loaded},unavailable_dependencies:[...unavailable],adapter_modules:Object.keys(adapters),journal_adapter:'production_repository',database_default_clock_fields:modelClockFields,effects:[...effects],database_errors:[...dbErrors],provider_errors:[...providerErrors],adapter_failures:[...adapterFailures],checkpoint_failure:checkpointFailure,database_boundary_failure:databaseBoundaryFailure?{...databaseBoundaryFailure}:null,full_planner_and_scheduler_replay:false,economic_roi:null})};
}
module.exports={createProductionPortfolioRuntime};

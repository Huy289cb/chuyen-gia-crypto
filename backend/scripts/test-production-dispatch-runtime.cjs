'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{PrismaClient}=require('@prisma/client');
const {createProductionPortfolioRuntime}=require('./production-portfolio-runtime.cjs');
const out=path.resolve(process.argv[2]??'');if(!process.argv[2]||fs.existsSync(out))throw Error('NEW_REPORT');
const url=process.env.ROI_ATOMIC_TEST_DATABASE_URL;if(!url)throw Error('explicit_isolated_database_required');
const parsed=new URL(url);if(parsed.hostname!=='127.0.0.1'||parsed.port!=='55439'||parsed.pathname!=='/crypto_reset_test'||parsed.searchParams.get('schema')!=='engine_baseline_production_runtime_v7')throw Error('refusing_nonisolated_fixture');
const db=new PrismaClient({datasources:{db:{url}}}),report={schema:'production-dispatch-runtime-proof-v1',production_touched:false,raw_exchange_and_provider_inputs:'synthetic',full_production_parity:false,economic_roi:null};let runtime;
(async()=>{
 const data=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../docs/audits/2026-10-03-upgrade-checkpoint/baseline-production-interim-v1/telemetry.json')));
 const source=data.events.find(e=>e.event_data.stage==='structure_permission_evaluated').event_data.structure_permission.input;
 const base=Date.now(),step4h=14400000;let reads=0,providerCalls=0,cached=null;
 const h4=source.candles.map((b,index)=>({...b,timestamp:Math.floor(base/step4h)*step4h-(source.candles.length-index)*step4h,open:b.close,volume:100}));
 const candles=Array.from({length:100},(_,index)=>({timestamp:Math.floor(base/300000)*300000-(101-index)*300000,open:84000,high:84100,low:83900,close:84000,volume:100}));
 Object.assign(candles.at(-1),{high:84650,low:83950,close:84645,volume:5000});
 const signal={pass:true,shouldCallGroq:true,isDuplicate:false,reason:'explicit fixture scan',gateRegime:'trend',setupResult:{grade:'A',confidence:.95,regime:'trend',playbookKey:'breakout_volume',evidence:{regime:{trendDirection:'bullish'},playbooks:[{playbook:'breakout_volume',detected:true,metrics:{}}]}}};
 const decisions=[];
 const recordedPlans=data.events.filter(e=>e.event_data.stage==='plan_geometry').map(e=>e.event_data);
 const analysis={bias:'bullish',action:'buy',confidence:.95,suggested_entry:84645,suggested_stop_loss:84560.4,suggested_take_profit:84901.6,expected_rr:3.03,invalidation_level:84565,reason_summary:'Explicit synthetic proposal for production validation and stop-floor veto.'};
 const adapters={
  'services/groq-client':{createGroqClient:()=>({analyze:async()=>{providerCalls++;return {...analysis};}})},
  'services/memory.service':{memoryService:{findDecisionForBar:async()=>cached,buildContextForLLM:async()=>null,formatRecentReflectionsForPrompt:async()=>'',storeDecision:async input=>{decisions.push(input);return{id:decisions.length};}}},
  'services/candle.service':{getCandles:async()=>({candles:h4,source:'fixture'})},
  'schedulers/market-scan.scheduler':{getScanResult:(_symbol,timeframe)=>({timestamp:base,timeframe,candles,signalResult:signal})},
  'services/openrouter-shadow.service':{observeOpenRouterShadowDecision:async()=>{}},
  'services/binance/market':{},
 };
 const environment={BINANCE_ENABLED:'true',MAX_EFFECTIVE_RISK_PER_TRADE_PERCENT:'3',MAX_EFFECTIVE_RISK_PER_TRADE_USD:'',DAILY_LOSS_LIMIT_PERCENT:'10',MIN_SL_DISTANCE_PERCENT:'0.008',RISK_PER_TRADE_PERCENT:'0.5',MAX_TOTAL_EXPOSURE_USD:'100',CIRCUIT_DRAWDOWN_ENABLED:'true',LLM_PROVIDER:'openrouter',GROQ_LEVELS_ADAPTER_PROVIDER:'openrouter',GROQ_LEVELS_ADAPTER_ENABLED:'true',OPENROUTER_ENABLED:'true',OPENROUTER_API_KEY:'offline_fixture_only'};
 runtime=createProductionPortfolioRuntime({runtimeRoot:path.resolve(__dirname,'../dist'),database:db,environment,externalAdapters:adapters,initialClock:base,readClock:at=>at+(reads++)});
 const before=await db.testnetPendingOrder.count();
 const result=await runtime.step({kind:'dispatch',at:base,input:{symbol:'BTC',timeframe:'5m',candles,systemPrompt:'Fixture: confirm or veto with valid levels.',method_id:'kim_nghia',signalResult:signal}});
 report.result=result.result;report.provider_calls=providerCalls;report.decisions=decisions;
 cached={id:10001,decision:'trade',reason:'LLM: buy cached fixture',confidence:analysis.confidence,entry_price:analysis.suggested_entry,stop_loss:analysis.suggested_stop_loss,take_profit:analysis.suggested_take_profit,expected_rr:analysis.expected_rr};
 const cachedResult=await runtime.step({kind:'dispatch',at:base+1000,input:{symbol:'BTC',timeframe:'5m',candles,systemPrompt:'Fixture: confirm or veto with valid levels.',method_id:'kim_nghia',signalResult:signal}});
 assert.equal(cachedResult.result.decision,'no_trade');assert.match(cachedResult.result.reason,/SL.*below minimum|SL distance|stop/i);assert.equal(providerCalls,1);
 report.cached_trade_current_guard_revalidated=true;report.cached_result=cachedResult.result;
 cached=null;report.recorded_price_cases=[];
 for(const [index,plan]of recordedPlans.entries()){
  Object.assign(analysis,{suggested_entry:plan.entry,suggested_stop_loss:plan.stop_loss,suggested_take_profit:plan.take_profit,expected_rr:(plan.take_profit-plan.entry)/(plan.entry-plan.stop_loss)});
  Object.assign(candles.at(-1),{close:plan.entry,high:plan.entry+5});
  const observed=await runtime.step({kind:'dispatch',at:base+2000+index*1000,input:{symbol:'BTC',timeframe:'5m',candles,systemPrompt:'Fixture: confirm or veto with valid levels.',method_id:'kim_nghia',signalResult:signal}});
  assert.equal(observed.result.decision,'no_trade');assert.match(observed.result.reason,/SL.*below minimum|SL distance|stop/i);
  report.recorded_price_cases.push({trace_id:plan.trace_id,entry:plan.entry,stop_loss:plan.stop_loss,take_profit:plan.take_profit,result:observed.result.reason});
 }
 report.levels_adapter_configured=runtime.load('services/groq-levels-adapter.service').isLevelsAdapterConfigured();assert.equal(report.levels_adapter_configured,true);assert.equal(providerCalls,1+recordedPlans.length);
 report.provider_calls=providerCalls;assert.equal(recordedPlans.length,5);
 assert.equal(result.result.decision,'no_trade');assert.match(result.result.reason,/SL.*below minimum|SL distance|stop/i);assert.equal(providerCalls,6);assert.equal(await db.testnetPendingOrder.count(),before);report.passed=true;
})().catch(error=>{report.passed=false;report.failure={name:error.name,message:error.message};process.exitCode=1;}).finally(async()=>{report.diagnostics=runtime?.diagnostics();report.completed_at=new Date().toISOString();await db.$disconnect();fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({passed:report.passed,providerCalls:report.provider_calls,failure:report.failure,result:report.result?.reason}));});

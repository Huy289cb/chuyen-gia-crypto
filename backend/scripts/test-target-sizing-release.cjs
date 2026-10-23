require('tsx/cjs');const {replayRecordedQuantityCheck,replayRecordedExecutionRisk,replayRecordedTargetSizing}=require('../src/utils/recorded-quantity-risk.ts');
require('tsx/cjs');const {composeTraceAdmission}=require('../src/utils/trace-admission-composition.ts');
require('tsx/cjs');const replayOccupancy=require('../src/utils/recorded-entry-occupancy.ts').replayRecordedEntryOccupancy;
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const pkg=path.resolve(process.argv[2]);
const clean=x=>JSON.parse(JSON.stringify(x));
function stripMetadata(x) {
  if(Array.isArray(x))return x.map(stripMetadata);
  if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).filter(([k])=>!['rejectionCode','code','trace'].includes(k)).map(([k,v])=>[k,stripMetadata(v)]));
  return x;
}
const fixed=Date.UTC(2026,8,14,3,50,10);
class Clock extends Date {constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}}
const env={NODE_ENV:'test',BINANCE_ENABLED:'true',MIN_SL_DISTANCE_PERCENT:'.008',MIN_RR_RATIO:'3',
  RISK_PER_TRADE_PERCENT:'.5',MAX_EFFECTIVE_RISK_PER_TRADE_PERCENT:'3',MAX_EFFECTIVE_RISK_PER_TRADE_USD:'',
  DAILY_LOSS_LIMIT_PERCENT:'10',BINANCE_MIN_ORDER_NOTIONAL_USD:'50',MAX_TOTAL_EXPOSURE_USD:'100',V3_SCALE_IN_ENABLED:'false',V3_OPPOSITE_FLIP_ENABLED:'false'};
function sandbox(variant,mocks={}) {
  const root=path.join(pkg,variant),cache=new Map();
  function load(name){
    name=name.replace(/\.js$/,'');if(name in mocks)return mocks[name];if(cache.has(name))return cache.get(name).exports;
    const file=path.join(root,name+'.js'),module={exports:{}};cache.set(name,module);
    const req=id=>{
      if(id.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(file),id)));
      if(['node:async_hooks','node:crypto','node:fs','node:path'].includes(id))return require(id);
      throw new Error('Unexpected external dependency '+id+' from '+name);
    };
    const context={module,exports:module.exports,require:req,__dirname:path.dirname(file),__filename:file,
      process:{env:{...env},pid:123},Date:Clock,Math:Object.assign(Object.create(Math),{random:()=>.125}),
      console:{log(){},warn(){},error(){}},setTimeout,clearTimeout,AbortSignal,structuredClone,
      fetch(){throw new Error('Network disabled in release tests');}};
    vm.runInNewContext(fs.readFileSync(file,'utf8'),context,{filename:file});return module.exports;
  }return load;
}
async function execution(variant,scenario) {
  const writes=[],events=[];env.V3_SCALE_IN_ENABLED=scenario.scale?'true':'false';env.V3_OPPOSITE_FLIP_ENABLED=scenario.flip?'true':'false';
  const risk={riskPerTradePercent:.5,minSlDistancePercent:.008,maxFeePercent:.1,maxSlippagePercent:.1,
    maxEffectiveRiskPerTradePercent:3,maxEffectiveRiskPerTradeUsd:null,maxPositionsPerSymbol:1,circuitDailyLossEnabled:true};
  const mocks={
    'config/methods':{getMethodConfig:()=>({autoEntry:{minSLDistancePercent:.008,minRRRatio:3}})},
    'config/risk-policy':{getRiskPolicy:()=>risk},
    'repositories/testnet.repository':{
      getOrCreateTestnetAccount:async(...args)=>{writes.push(['readAccount',clean(args)]);return {id:1,current_balance:scenario.balance??33.6};},
      getActiveTestnetPositions:async(...args)=>{writes.push(['readOpen',clean(args)]);if(scenario.readFailure)throw Error('read failed');return scenario.open?[{position_id:'p',side:scenario.opposite?'short':'long',status:'open'}]:[];},getBlockingTestnetPendingOrders:async(...args)=>{writes.push(['readPending',clean(args)]);return scenario.pending?[{order_id:'o',side:scenario.opposite?'short':'long',status:scenario.unresolved?'reconciliation_failed_not_on_binance':'pending'}]:[];},
      createTestnetPendingOrder:async x=>{writes.push(['pending',clean(x)]);if(scenario.pendingFailure)throw Error('pending failed');return {order_id:x.orderId,account_id:x.accountId,binance_order_id:x.binanceOrderId};},
      recordPipelineEvent:async(type,data)=>{events.push([type,clean(data)]);if(type==='entry_trace'&&data.stage==='entry_occupancy_evaluated'){if(scenario.journal==='failed')throw Error('journal');if(scenario.journal==='pending')return new Promise(()=>{});}return 1;},
      recordSilentPipelineEvent:async(type,data)=>{events.push([type,clean(data)]);if(type==='entry_trace'&&data.stage==='entry_occupancy_evaluated'){if(scenario.journal==='failed')throw Error('journal');if(scenario.journal==='pending')return new Promise(()=>{});}return 1;},
    },
    'services/account-risk-guard.service':{assertTestnetAccountCanOpenTrade:async(...args)=>{writes.push(['guard',clean(args)]);return {allowed:!scenario.blockAccount,reason:'account blocked',remainingDailyRiskUsd:scenario.daily??3.36};}},
    'services/binance-account-health.service':{checkBinanceAccountTradable:async()=>({tradable:true})},
    'services/opposite-flip.service':{tryOppositeFlipBeforeEntry:async()=>{writes.push(['flip']);return {reason:'no opposite exposure',flipped:false};}},
    'services/v3-entry-eligibility.service':{
      assertScaleInSideAllowed:async()=>null,assertSameSidePostCloseCooldown:async()=>scenario.cooldown?'cooldown':null,
      oppositeLocalSide:s=>s==='long'?'short':'long',getSymbolExposureSnapshot:async(...args)=>{writes.push(['exposure',clean(args)]);return {totalUsd:0,maxExposureUsd:100,remainingUsd:scenario.exposure??100,openUsd:0};},
    },
    'services/binance-hedge-mode':{ensurePositionModeDetected:async()=>{}},
    'services/binanceClient':{initTestnetClient:()=>({}),normalizeQuantityForSymbol:async()=>({stepSize:.001,minQty:.001}),
      placeLimitOrder:async(...args)=>{writes.push(['exchange',clean(args)]);if(scenario.exchangeFailure)throw Error('exchange failed');return {orderId:123};}},
    'services/telegram/telegram-hooks':{hookPendingOrderPlaced:()=>{}},
  };
  const load=sandbox(variant,mocks);
  const analysis=scenario.analysis??{action:'buy',suggested_entry:77000,suggested_stop_loss:76384,suggested_take_profit:78848,expected_rr:3};
  let result;try{result=await load('services/v3-trade-execution.service').executeV3Trade({symbol:'BTC',timeframe:'15m',analysis,decisionRecordId:997});}catch(error){result={threw:error.message};}
  return {result:stripMetadata(clean(result)),writes,events};
}


(async()=>{let cases=0,journalCases=0,occupancyCases=0,compositionCases=0,quantityRiskPayloads=0,targetSizingPayloads=0;
const scenarios=[{pending:true},{pending:true,unresolved:true},{open:true,scale:true},{open:true,opposite:true,scale:true},{pending:true,opposite:true,scale:true},{open:true,opposite:true,scale:true,flip:true},{readFailure:true},{journal:'failed'},{journal:'pending'},{}, {pendingFailure:true},{exchangeFailure:true}, {balance:1},{exposure:50},{daily:.2},{open:true},{cooldown:true},{blockAccount:true},
 {analysis:{action:'buy',suggested_entry:77000,suggested_stop_loss:76384,suggested_take_profit:77500}},
 {analysis:{action:'sell',suggested_entry:77000,suggested_stop_loss:77616,suggested_take_profit:75152}},
 {analysis:{action:'buy',suggested_entry:77000,suggested_stop_loss:76384,suggested_take_profit:78848,invalidation_level:76900}},
 {analysis:{action:'buy',suggested_entry:77000,suggested_stop_loss:76384,suggested_take_profit:78848,invalidation_level:76200}}];
for(const scenario of scenarios){const a=await execution('baseline',scenario),b=await execution('release',scenario);
 assert.deepStrictEqual(b.result,a.result);assert.deepStrictEqual(b.writes,a.writes);
 for(const [type,data]of b.events){if(type!=='entry_trace'||!['quantity_checked','risk_checked'].includes(data.stage))continue;const decoded=data.stage==='quantity_checked'?replayRecordedQuantityCheck(data):replayRecordedExecutionRisk(data);assert.equal(decoded.status,'evaluated');assert.equal(decoded.matches_recorded,true);if(data.stage==='quantity_checked'){const sizing=replayRecordedTargetSizing(data);assert.equal(sizing.status,'evaluated');assert.equal(sizing.matches_recorded,true);targetSizingPayloads++;}quantityRiskPayloads++;}
 const composed=composeTraceAdmission(b.events.map(([event_type,event_data],i)=>({id:i+1,event_type,event_data,timestamp:new Date(fixed).toISOString()})),Math.max(fixed,Date.now()));for(const row of composed.traces){assert.equal(row.final_admission,null);assert.notEqual(row.status,'observed_read_subsequence');}compositionCases++;
 for(const [type,data]of b.events.filter(([type,data])=>type==='entry_trace'&&data.stage==='entry_occupancy_evaluated')){const decoded=replayOccupancy(data.input,Math.max(fixed,Date.now()));assert.equal(decoded.status,'evaluated');assert.deepStrictEqual(clean(decoded.decision),data.decision);occupancyCases++;}
 for(const [type,data]of b.events.filter(([type,data])=>type==='entry_trace'&&data.stage==='pending_create_write_observed')){const replay=clean(sandbox('release').call(null,'utils/pending-create-observation').replayPendingCreation(data,Math.max(fixed,Date.now())));assert.equal(replay.status,data.outcome==='returned'?'pending_create_contract_replayed':'unknown');}

 const journal=b.events.filter(([type,data])=>type==='entry_trace'&&data.stage==='post_quantity_evaluated');
 if(journal.length){assert.equal(journal.length,1);const load=sandbox('release');const replay=clean(load('utils/recorded-post-quantity').replayRecordedPostQuantity(journal[0][1].input));
 assert.equal(replay.status,'evaluated');assert.deepStrictEqual(replay.decision,journal[0][1].decision);journalCases++;}cases++;
}
assert(journalCases>0,'No execution reached shared journal branch');
assert(occupancyCases>0);const report={cases,journalCases,occupancyCases,compositionCases,quantityRiskPayloads,targetSizingPayloads,executionResultsAndWritesParity:true,orderedScopedReadsGuardAndExposureParity:true,recordedComponentReplay:true,dbExchangeMocked:true};fs.writeFileSync(path.join(pkg,'compiled-target-sizing-release-parity.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});

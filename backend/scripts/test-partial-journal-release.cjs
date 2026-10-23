const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const pkg=path.resolve(process.argv[2]);
function load(variant,file,mocks){const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(pkg,variant,file),'utf8'),{module,exports:module.exports,require:id=>{assert(id in mocks,'unexpected import '+id);return mocks[id];},process:{env:{}},console:{log(){},warn(){},error(){}},Promise,Date,Number,JSON,parseFloat});return module.exports;}
const local={order_id:'local',account_id:1,symbol:'BTC',side:'long',binance_order_id:'999',status:'pending',entry_price:64000,stop_loss:63000,take_profit:66000,risk_usd:0.2,risk_percent:0.5,expected_rr:2};
function fill(variant,{finalStatus='CANCELED',cancelFails=false,finalQty=.002}={}){
 let rows=[],protections=0,writes=[],probes=0,cancels=0,journals=[];
 const mod=load(variant,'services/binance-order-fill.service.js',{
 '../utils/partial-fill-evidence':variant==='release'?require(path.join(pkg,variant,'utils/partial-fill-evidence.js')):{},
 '../utils/execution-risk':{computeExecutionRisk:()=>({totalRiskUsd:.2,riskPercent:.5})},'../config/risk-policy':{getRiskPolicy:()=>({maxFeePercent:.1,maxSlippagePercent:.1})},
 '../repositories/testnet.repository':{findTestnetPositionByBinanceOrderId:async()=>rows[0]??null,
 recordSilentPipelineEvent:async(type,data)=>journals.push({type,data}),
 createTestnetPosition:async p=>{await Promise.resolve();rows.push({position_id:p.positionId,...p});},
 executeTestnetPendingOrder:async()=>{},recordTestnetTradeEvent:async()=>{},updateTestnetPendingOrder:async(_id,data)=>writes.push(data),PIPELINE_EVENT_POSITION_ID:'pipeline'},
 '../lib/prisma':{prisma:{testnetPosition:{findUnique:async()=>rows[0],findFirst:async()=>null},testnetTradeEvent:{findMany:async()=>[]}}},
 './protective-order.service':{resolveLevelsForFill:()=>({stop_loss:63000,take_profit:66000}),placeProtectiveOrdersForPosition:async()=>{protections++;}},
 './binance-account-health.service':{isBinanceOrderStateProbeUnavailable:()=>false},
 './binance-exposure.service':{fetchActiveBinancePositions:async()=>[{symbol:'BTC',side:'long',positionAmt:finalQty,entryPrice:63900}],fetchBinanceNetPosition:async()=>null},
 './binance-balance-sync.service':{resolveTestnetAccountBalances:async()=>({account_balance:40,account_equity:40})},
 './binance/trading':{cancelOrder:async()=>{cancels++;if(cancelFails)throw Error('cancel raced fill');},getOrder:async()=>{probes++;return probes===1?
 {orderId:999,symbol:'BTCUSDT',status:'PARTIALLY_FILLED',executedQty:.001}:
 {orderId:999,symbol:'BTCUSDT',status:finalStatus,executedQty:finalQty,cummulativeQuoteQty:finalQty*63900,avgPrice:63900,price:64000,updateTime:Date.now()};}},
 });
 return {mod,snapshot:()=>({rows,protections,writes,probes,cancels,journals})};
}

(async()=>{let cases=0,replayCases=0;
for(const scenario of [{},{finalStatus:'FILLED',cancelFails:true},{finalStatus:'PARTIALLY_FILLED',cancelFails:true},{finalQty:.0005}]){
 const a=fill('baseline',scenario),b=fill('release',scenario);
 const ar=await a.mod.recoverPendingOrderFromBinance(local),br=await b.mod.recoverPendingOrderFromBinance(local);
 assert.equal(br,ar);const x=a.snapshot(),y=b.snapshot();
 for(const key of ['protections','probes','cancels'])assert.equal(y[key],x[key]);
 assert.deepStrictEqual(JSON.parse(JSON.stringify(y.writes)),JSON.parse(JSON.stringify(x.writes)));
 assert.equal(y.rows.length,x.rows.length);
 const helper=require(path.join(pkg,'release/utils/partial-fill-evidence.js'));assert.equal(y.journals.length,1);
 const replay=helper.replayRecordedPartialRequery(JSON.parse(JSON.stringify(y.journals[0].data)),Date.now());assert.equal(replay.status,'evaluated');
 if(br==='filled')assert.equal(replay.next_action,'materialization_checks');
 else if(br==='unchanged')assert.equal(replay.next_action,'keep_pending');
 else assert.equal(replay.next_action,'invalid_final');cases++;replayCases++;
}console.log(JSON.stringify({cases,replayCases,compiledRecoveryParity:true,noNetworkOrDatabase:true}));
})().catch(e=>{console.error(e);process.exitCode=1;});

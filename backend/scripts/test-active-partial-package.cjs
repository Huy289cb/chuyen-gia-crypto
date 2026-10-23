const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const pkg=path.resolve(process.argv[2]),manifest=JSON.parse(fs.readFileSync(path.join(pkg,'manifest.json')));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.deepEqual(manifest.changedFiles,['services/binance-order-fill.service.js','services/binance-reconciliation.js','services/binance-websocket-sync.js','services/binance/trading.js']);
for(const variant of ['baseline','release'])for(const[f,h]of Object.entries(manifest[variant]))assert.equal(sha(fs.readFileSync(path.join(pkg,variant,f))),h);
function load(variant,file,mocks){const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(pkg,variant,file),'utf8'),{module,exports:module.exports,require:id=>{assert(id in mocks,'unexpected import '+id);return mocks[id];},process:{env:{}},console:{log(){},warn(){},error(){}},Promise,Date,Number,JSON,parseFloat});return module.exports;}
const local={order_id:'local',account_id:1,symbol:'BTC',side:'long',binance_order_id:'999',status:'pending',entry_price:64000,stop_loss:63000,take_profit:66000,risk_usd:0.2,risk_percent:0.5,expected_rr:2};
function fill(variant,{finalStatus='CANCELED',cancelFails=false,finalQty=.002}={}){
 let rows=[],protections=0,writes=[],probes=0,cancels=0;
 const mod=load(variant,'services/binance-order-fill.service.js',{
 '../utils/execution-risk':{computeExecutionRisk:()=>({totalRiskUsd:.2,riskPercent:.5})},'../config/risk-policy':{getRiskPolicy:()=>({maxFeePercent:.1,maxSlippagePercent:.1})},
 '../repositories/testnet.repository':{findTestnetPositionByBinanceOrderId:async()=>rows[0]??null,
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
 return {mod,snapshot:()=>({rows,protections,writes,probes,cancels})};
}
(async()=>{let checks=0;
 for(const variant of ['baseline','release']){
  const f=fill(variant);await Promise.all([f.mod.materializePositionFromPendingFill(local,.001,63900),f.mod.materializePositionFromPendingFill(local,.001,63900)]);
  assert.equal(f.snapshot().rows.length,variant==='baseline'?2:1);checks++;
  const raw={orderId:999,symbol:'BTCUSDT',price:'64000',executedQty:'.002',cumQuote:'127.8',avgPrice:'63900'};
  const api=load(variant,'services/binance/trading.js',{'./client':{get:async()=>raw},'./endpoints':{endpoints:{ORDER:'mock'}}});
  const q=await api.getOrder('BTCUSDT',999);
  if(variant==='baseline')assert(Number.isNaN(q.cummulativeQuoteQty));else{assert.equal(q.cummulativeQuoteQty/q.executedQty,63900);assert.equal(q.avgPrice,63900);}checks++;
 }
 const old=fill('baseline');assert.equal(await old.mod.recoverPendingOrderFromBinance(local),'unchanged');assert.equal(old.snapshot().cancels,0);assert.equal(old.snapshot().protections,0);checks++;
 for(const scenario of [{},{finalStatus:'FILLED',cancelFails:true}]){
  const f=fill('release',scenario);assert.equal(await f.mod.recoverPendingOrderFromBinance(local),'filled');const r=f.snapshot();
  assert.equal(r.cancels,1);assert.equal(r.probes,2);assert.equal(r.rows.length,1);assert.equal(r.rows[0].sizeQty,.002);assert.equal(r.rows[0].entryPrice,63900);assert.equal(r.protections,1);checks++;
 }
 const unresolved=fill('release',{finalStatus:'PARTIALLY_FILLED',cancelFails:true});assert.equal(await unresolved.mod.recoverPendingOrderFromBinance(local),'unchanged');assert.equal(unresolved.snapshot().rows.length,0);assert.equal(unresolved.snapshot().writes.length,0);checks++;
 const invalid=fill('release',{finalQty:.0005});assert.equal(await invalid.mod.recoverPendingOrderFromBinance(local),'failed');assert.equal(invalid.snapshot().rows.length,0);assert.equal(invalid.snapshot().writes.length,0);checks++;
 const report={checks,baselineConcurrentDuplicationReproduced:true,baselineRawQuoteLossReproduced:true,baselineActivePartialUnprotectedReproduced:true,fullPackageHashesVerified:true,liveOrdersSent:0};
 fs.writeFileSync(path.join(pkg,'active-partial-tests.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});

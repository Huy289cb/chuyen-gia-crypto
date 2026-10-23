// Executes sealed runtime modules with exchange/storage adapters; never uses live services.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const pkg=path.resolve(process.argv[2]);
const manifest=JSON.parse(fs.readFileSync(path.join(pkg,'manifest.json')));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.deepEqual(manifest.changedFiles,['services/binance-order-fill.service.js','services/binance-websocket-sync.js']);
for(const variant of ['baseline','release'])for(const [f,h]of Object.entries(manifest[variant]))assert.equal(sha(fs.readFileSync(path.join(pkg,variant,f))),h);
function load(variant,file,mocks){const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(pkg,variant,file),'utf8'),{module,exports:module.exports,require:id=>{assert(id in mocks,'unmocked import '+id);return mocks[id];},process:{env:{}},console:{log(){},warn(){},error(){}},Promise,Date,Number,JSON,parseFloat});return module.exports;}
const local={order_id:'local',account_id:1,symbol:'BTC',side:'long',entry_price:64000,binance_order_id:'123',status:'pending'};
async function websocket(variant,status,qty){let fills=[],writes=0,hooks=0;
 const mod=load(variant,'services/binance-websocket-sync.js',{'ws':{},'./binance/stream':{},
 '../repositories/testnet.repository':{updateTestnetPendingOrder:async()=>writes++,recordPipelineEvent:async()=>{}},
 '../lib/prisma':{prisma:{testnetPendingOrder:{updateMany:async()=>{writes++;return {count:1};}}}},
 './binance-order-fill.service':{findLocalOrderForBinanceEvent:async()=>local,resolveFillQty:(_o,q)=>q,
 resolveFillAvgPrice:()=>64000,materializePositionFromPendingFill:async(...args)=>{fills.push(args);return 'pos';}},
 './position-close.service':{},'./telegram/telegram-hooks':{hookPendingCancelled:()=>hooks++},
 './pending-order-actions':{isPendingOrderTerminal:()=>false}});
 await mod.handleOrderTradeUpdate({E:Date.now(),o:{i:123,s:'BTCUSDT',X:status,o:'LIMIT',z:String(qty),ap:'64000'}});
 return {fills,writes,hooks};
}
async function polling(variant,status,qty,{existing=true,stale=false,terminal=false}={}){let linked=0,protectedCount=0,writes=[];
 const mod=load(variant,'services/binance-order-fill.service.js',{
 '../utils/execution-risk':{},'../config/risk-policy':{},
 '../repositories/testnet.repository':{findTestnetPositionByBinanceOrderId:async()=>existing?{position_id:'pos'}:null,
 executeTestnetPendingOrder:async()=>linked++,updateTestnetPendingOrder:async(_id,data)=>writes.push(data)},
 '../lib/prisma':{prisma:{testnetPosition:{findUnique:async()=>({position_id:'pos',binance_sl_order_id:null,binance_tp_order_id:null}),findFirst:async()=>null}}},
 './protective-order.service':{placeProtectiveOrdersForPosition:async()=>{protectedCount++;return {slPlaced:true,tpPlaced:true};}},
 './binance-account-health.service':{isBinanceOrderStateProbeUnavailable:()=>false},
 './binance/trading':{getOrder:async()=>({status,executedQty:qty,cummulativeQuoteQty:qty*64000,price:64000,
 updateTime:Date.now()-(stale?3600000:1000)})},
 './binance-exposure.service':{fetchActiveBinancePositions:async()=>[]},
 });
 const outcome=await mod.recoverPendingOrderFromBinance({...local,status:terminal?'executed':'pending'});
 return {outcome,linked,protectedCount,writes};
}
(async()=>{let checks=0;
 for(const status of ['CANCELED','EXPIRED','REJECTED']){
  const old=await websocket('baseline',status,.001);assert.equal(old.fills.length,0);assert.equal(old.writes,1);checks++;
  const fixed=await websocket('release',status,.001);assert.equal(fixed.fills.length,1);assert.equal(fixed.fills[0][1],.001);assert.equal(fixed.writes,0);assert.equal(fixed.hooks,0);checks++;
  const zero=await websocket('release',status,0);assert.equal(zero.fills.length,0);assert.equal(zero.writes,1);checks++;
  assert.equal((await polling('baseline',status,.001)).outcome,'cancelled');checks++;
  const recovered=await polling('release',status,.001);assert.equal(recovered.outcome,'filled');assert.equal(recovered.linked,1);assert.equal(recovered.protectedCount,1);assert.equal(recovered.writes.length,0);checks++;
  const duplicate=await polling('release',status,.001,{terminal:true});assert.equal(duplicate.outcome,'filled');assert.equal(duplicate.linked,0);assert.equal(duplicate.protectedCount,1);checks++;
  const flat=await polling('release',status,.001,{existing:false,stale:true});assert.equal(flat.outcome,'stale_skipped');assert.equal(flat.linked,0);assert.equal(flat.writes[0].status,'executed_historical');assert.equal(flat.writes[0].executed_size_qty,.001);checks++;
  const cancel=await polling('release',status,0);assert.equal(cancel.outcome,'cancelled');assert.equal(cancel.linked,0);checks++;
 }
 const report={checks,baselineDefectReproduced:true,fullPackageHashesVerified:true,actualPackagedModules:true,liveOrdersSent:0};
 fs.writeFileSync(path.join(pkg,'partial-terminal-tests.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});

const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const pkg=path.resolve(process.argv[2]),manifest=JSON.parse(fs.readFileSync(path.join(pkg,'manifest.json'))),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.deepEqual(manifest.changedFiles,['services/binance/trading.js','services/pending-order-actions.js']);
for(const variant of ['baseline','release'])for(const [f,h] of Object.entries(manifest[variant]))assert.equal(sha(fs.readFileSync(path.join(pkg,variant,f))),h);
function load(variant,file,mocks){const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(pkg,variant,file),'utf8'),{module,exports:module.exports,require:id=>{if(!(id in mocks))throw Error('unmocked import '+id);return mocks[id];},process:{env:{BINANCE_ENABLED:'true'}},console:{log(){},warn(){},error(){}},Promise});return module.exports;}
const ack={orderId:123,symbol:'BTCUSDT',status:'CANCELED',executedQty:'0'};
async function run(variant,scenario){let status=scenario.initial??'pending',writes=0,events=0,calls=0,error=null;
 const api=load(variant,'services/binance/trading.js',{'./client':{del:async()=>{calls++;if(scenario.fail)throw Error('network');return {...ack,...scenario.ack};}},'./endpoints':{endpoints:{CANCEL_ORDER:'mock'}}});
 const actions=load(variant,'services/pending-order-actions.js',{'../lib/prisma':{prisma:{testnetPendingOrder:{findUnique:async()=>({status}),updateMany:async({data})=>{if(scenario.race){status='executed';return {count:0};}writes++;status=data.status;return {count:1};}}}},'../repositories/testnet.repository':{PIPELINE_EVENT_POSITION_ID:'pipeline',recordPipelineEvent:async()=>events++},'./telegram/telegram-hooks':{hookPendingCancelled(){}},'./binanceClient':{initTestnetClient:()=>({}),cancelOrder:async(_c,s,id)=>api.cancelOrder(s,id)}});
 try{await actions.cancelPendingOnExchangeAndDb({order_id:'local',symbol:'BTC',binance_order_id:'123'},'ttl_expired');}catch(e){error=e.message;}
 return {status,writes,events,calls,error};}
(async()=>{
 const old=await run('baseline',{fail:true});assert.equal(old.status,'cancelled_ttl_expired');assert.equal(old.error,null);
 let checks=1;
 for(const scenario of [{fail:true},{ack:{executedQty:'.001'}},{ack:{executedQty:undefined}},{ack:{status:'FILLED'}},{ack:{orderId:999}},{ack:{symbol:'ETHUSDT'}}]){
  const result=await run('release',scenario);assert.equal(result.status,'pending');assert.equal(result.writes,0);assert.equal(result.events,0);assert(result.error);checks++;
 }
 const good=await run('release',{});assert.equal(good.status,'cancelled_ttl_expired');assert.equal(good.events,1);assert.equal(good.error,null);checks++;
 const race=await run('release',{race:true});assert.equal(race.status,'executed');assert.equal(race.events,0);checks++;
 const terminal=await run('release',{initial:'executed'});assert.equal(terminal.calls,0);assert.equal(terminal.writes,0);checks++;
 const report={checks,sourceHashesVerified:true,baselineDefectReproduced:true,packagedWrapperRetainsExecutedQty:true,exchangeAndDbMocked:true,liveOrdersSent:0};
 fs.writeFileSync(path.join(pkg,'cancel-tests.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1});

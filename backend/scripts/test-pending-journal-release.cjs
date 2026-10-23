const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]);
async function run(tree,s){
 const writes=[],journals=[],events=[],file=path.join(root,tree,'services/pending-order-actions.js');
 const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
 m.require=id=>{
 if(id==='node:crypto')return require(id);
 if(id==='../utils/pending-cancel-transition')return require(path.join(root,tree,'utils/pending-cancel-transition.js'));
 if(id==='../lib/prisma')return {prisma:{testnetPendingOrder:{findUnique:async()=>({status:s.status}),updateMany:async q=>{writes.push(['db',q]);return {count:s.count};}}}};
 if(id==='../repositories/testnet.repository')return {PIPELINE_EVENT_POSITION_ID:'pipeline',recordPipelineEvent:async(type,data)=>events.push({type,data}),recordSilentPipelineEvent:async(type,data)=>{journals.push({type,data});if(s.journalFail)throw Error('mock');return 1;}};
 if(id==='./telegram/telegram-hooks')return {hookPendingCancelled:(...args)=>writes.push(['hook',args])};
 if(id==='./binanceClient')return {initTestnetClient:()=>({}),cancelOrder:async(...args)=>{writes.push(['exchange',args]);if(s.networkFail)throw Error('network');return s.ack;}};
 throw Error('unapproved_import:'+id);
 };m._compile(fs.readFileSync(file,'utf8'),file);
 let error=null;try{await m.exports.cancelPendingOnExchangeAndDb({order_id:'local',symbol:'BTC',binance_order_id:'123'},'ttl_expired');}catch(e){error=e.message;}
 return {writes,events,journals,error};
}
(async()=>{let cases=0,pairs=0;const prior=process.env.BINANCE_ENABLED;process.env.BINANCE_ENABLED='true';try{
 for(const status of ['pending','partially_filled','executed'])for(const count of [0,1])for(const qty of ['0','.001']){
  const s={status,count,ack:{orderId:123,symbol:'BTCUSDT',status:'CANCELED',executedQty:qty}};
  const a=await run('baseline',s),b=await run('release',s);assert.deepStrictEqual(b.writes,a.writes);assert.deepStrictEqual(b.events,a.events);assert.equal(b.error,a.error);
  if(b.journals.length===2){const helper=require(path.join(root,'release/utils/pending-cancel-transition.js'));const result=helper.replayRecordedCancelClaim(b.journals[0].data,b.journals[1].data);assert.equal(result.status,'evaluated');assert.equal(result.occupancy_released,count===1);pairs++;}cases++;
 }
 assert(pairs>0);console.log(JSON.stringify({cases,pairedReplayCases:pairs,compiledWritesAndErrorsParity:true,networkAndDbMocked:true}));
}finally{if(prior===undefined)delete process.env.BINANCE_ENABLED;else process.env.BINANCE_ENABLED=prior;}})().catch(e=>{console.error(e);process.exitCode=1;});

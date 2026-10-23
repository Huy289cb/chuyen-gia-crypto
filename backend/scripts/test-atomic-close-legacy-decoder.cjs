require('tsx/cjs');const {buildObservedCloseLedger}=require('../src/utils/observed-close-ledger.ts');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const pkg=path.resolve(process.argv[2]),now=Date.now();
async function run(variant,scenario){
 const writes=[],events=[],effects=[];const result={verified:scenario.verified??true,realizedPnl:scenario.pnl??-1,closePrice:110,source:'user_trades',tradeIds:[1,2],closeQty:.01,entryFee:.01,exitFee:.02,fundingFee:0};
 const mocks={
  '../lib/prisma':{prisma:{testnetAccount:{update:async value=>{if(scenario.dbFailure)throw Error('db');writes.push(['account',value]);}}}},
  '../repositories/testnet.repository':{closeTestnetPosition:async(...args)=>{if(scenario.closeFailure)throw Error('close failed');return writes.push(['close',...args]);},updateTestnetPosition:async(...args)=>{if(scenario.updateFailure)throw Error('update failed');return writes.push(['position',...args]);},recordTestnetTradeEvent:(...args)=>{events.push(args);if(args[1]==='close_account_update_applied'){if(scenario.journal==='failed')return Promise.reject(Error('journal'));if(scenario.journal==='pending')return new Promise(()=>{});}return Promise.resolve();}},
  './binance-hedge-mode':{},'./binanceClient':{},
  './binance-balance-sync.service':{syncTestnetAccountFromBinance:async()=>{effects.push('sync');if(scenario.syncFailure)throw Error('sync');},resolveTestnetAccountBalances:async()=>({account_balance:29,account_equity:29})},
  './trade-outcome.service':{recordTradeOutcomeOnClose:async(...args)=>effects.push(['outcome',...args])},
  './account-risk-guard.service':{applyConsecutiveLossCooldownIfNeeded:async(...args)=>effects.push(['cooldown',...args])},
  './binance-fill-pnl.service':{resolveClosePnlFromUserTrades:async()=>result},
  './close-reason-resolve.service':{resolveVerifiedCloseReason:reason=>reason},
 };
 if(scenario.realResolver){
 const opening=scenario.short?'SELL':'BUY',closing=scenario.short?'BUY':'SELL';
 const fills=[{tradeId:1,orderId:'entry',side:opening,price:100,qty:1,commission:.1,commissionAsset:'USDT',realizedPnl:0,time:now-3000},{tradeId:2,orderId:'partial',side:closing,price:scenario.short?90:110,qty:.5,commission:.05,commissionAsset:'USDT',realizedPnl:5,time:now-2000},{tradeId:3,orderId:'final',side:closing,price:scenario.short?80:120,qty:.5,commission:.05,commissionAsset:'USDT',realizedPnl:10,time:now-1000}];
 const mod={exports:{}},fillFile=path.join(pkg,variant,'services/binance-fill-pnl.service.js');
 vm.runInNewContext(fs.readFileSync(fillFile,'utf8'),{module:mod,exports:mod.exports,require:id=>{if(id==='./binance-trade-history.service')return {fetchUserTradesByTimeWindows:async()=>fills};if(id==='./binance-income.service')return {fetchBinanceIncomeRows:async()=>[]};if(id.startsWith('../utils/'))return require(path.resolve(path.dirname(fillFile),id+'.js'));throw Error('unexpected '+id);},process:{env:{BINANCE_ENABLED:'true'}},Date,console:{warn(){}}},{filename:fillFile});
 mocks['./binance-fill-pnl.service']=mod.exports;
 }
 const exports={},file=path.join(pkg,variant,'services/position-close.service.js');
 const fixedDate=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{exports,require:id=>{if(id==='node:crypto')return require(id);if(Object.hasOwn(mocks,id))return mocks[id];if(id.startsWith('../utils/'))return require(path.resolve(path.dirname(file),id+'.js'));throw Error('unmocked '+id);},process:{env:{BINANCE_ENABLED:scenario.enabled===false?'false':'true'}},Date:fixedDate,console:{log(){},warn(){},error(){}}},{filename:file});
 const position={position_id:'case',account_id:1,symbol:'BTC',side:scenario.short?'short':'long',entry_price:100,size_qty:scenario.realResolver?(scenario.short?-1:1)*(scenario.qty??.5):.01,partial_closed:scenario.partial?1:0,entry_time:new Date(now-3600000),account:{current_balance:scenario.realResolver?34.95:30},...(scenario.bookkeeping?{}:{binance_order_id:'entry'}),...(scenario.closed?{status:'closed'}:{})};
 let outcome,error,timer;
 try{outcome=await Promise.race([exports.closeLocalPosition(position,110,scenario.bookkeeping?'reconciliation_bookkeeping':'manual_close'),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('blocked')),1000))]);}catch(e){error=e.message;}finally{clearTimeout(timer);}
 await Promise.resolve();await Promise.resolve();const json=v=>JSON.parse(JSON.stringify(v));return {outcome,error,writes:json(writes),events:json(events),effects:json(effects)};
}

function stable(value){
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object'){const result={};for(const [key,v]of Object.entries(value)){if(['attempt_id','close_attempt_id'].includes(key))result[key]='identity';else if(['write_started_at','write_returned_at','applied_at','last_trade_time','updated_at','close_time'].includes(key)&&typeof v==='string')result[key]='clock';else if(key==='wallet_authoritative'&&v===false)continue;else result[key]=stable(v);}return result;}
 return value;
}
(async()=>{
 const cases=[];
 for(const scenario of [{verified:false},{verified:false,short:true},{verified:false,partial:true},{verified:false,syncFailure:true},{verified:false,closeFailure:true},{verified:false,updateFailure:true},{verified:false,enabled:false},{verified:false,enabled:false,pnl:0},{verified:false,enabled:false,dbFailure:true},{verified:false,enabled:false,journal:'failed'},{verified:false,enabled:false,journal:'pending'},{bookkeeping:true},{bookkeeping:true,closeFailure:true},{bookkeeping:true,updateFailure:true},{bookkeeping:true,syncFailure:true},{closed:true}]){
  const baseline=await run('baseline',scenario),release=await run('release',scenario);
  assert.deepEqual(stable(release),stable(baseline),JSON.stringify(scenario));assert(!release.events.some(e=>e[1]==='atomic_verified_close_committed'));
  cases.push({scenario,result:release.outcome??null,error:release.error??null,writes:release.writes.length,events:release.events.length,parity:true});
 }
 const source=require('../src/utils/atomic-verified-close.ts').replayAtomicVerifiedClose,compiled=require(path.join(pkg,'release/utils/atomic-verified-close.js')).replayAtomicVerifiedClose;
 const proof=JSON.parse(fs.readFileSync(path.join(pkg,'compiled-atomic-close-postgres-proof-v2.json')));let comparisons=0,valid=0,rejected=0;
 for(const c of proof.results){const receipt=c.events.find(e=>e.event_type==='atomic_verified_close_committed').event_data,cutoff=Date.parse(receipt.committed_return_at)+1;
  const changes=[()=>{},d=>d.schema='wrong',d=>d.account_id+=1,d=>d.account_update.total_trades.increment=2,d=>d.position_update.realized_pnl+=1,d=>d.input.entryFee=-1,d=>d.account_balance_before+=1,d=>d.committed_return_at=new Date(cutoff+1).toISOString(),d=>d.clock_source='wrong'];
  for(const edit of changes){const d=structuredClone(receipt);edit(d);const a=source(d,cutoff),b=compiled(d,cutoff);assert.deepEqual(b,a);comparisons++;if(b.status==='evaluated'&&b.matches_recorded)valid++;else rejected++;}
 }
 assert.equal(valid,10);assert.equal(rejected,35);
 fs.writeFileSync(path.join(pkg,'atomic-close-legacy-decoder-proof-v1.json'),JSON.stringify({legacyCompiledCases:cases.length,cases,decoderComparisons:comparisons,valid,rejected,clockAndUuidOnlyNormalization:true,optionalFalseWalletFlagNormalized:true,dbExchangeMockedForLegacy:true,decoderInputFromRealIsolatedPostgresHandler:true,walletAuthoritativeBalanceBeforeNotIndependentlyVerified:true,productionTouched:false},null,2),{flag:'wx',mode:0o600});console.log({legacy:cases.length,decoder:comparisons,passed:true});
})().catch(e=>{console.error(e);process.exitCode=1;});

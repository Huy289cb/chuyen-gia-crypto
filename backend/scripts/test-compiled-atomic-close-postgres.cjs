const {PrismaClient}=require('@prisma/client');const testUrl=process.env.ROI_ATOMIC_TEST_DATABASE_URL;if(!testUrl)throw Error('missing_test_url');const parsed=new URL(testUrl);if(parsed.hostname!=='127.0.0.1'||parsed.port!=='55439'||parsed.pathname!=='/crypto_reset_test')throw Error('refusing_nonisolated_db');const db=new PrismaClient({datasources:{db:{url:testUrl}}});
require('tsx/cjs');const {buildObservedCloseLedger}=require('../src/utils/observed-close-ledger.ts');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const pkg=path.resolve(process.argv[2]),now=Date.now();
async function run(variant,scenario){
 const writes=[],events=[],effects=[];const result={verified:scenario.verified??true,realizedPnl:scenario.pnl??-1,closePrice:110,source:'user_trades',tradeIds:[1,2],closeQty:.01,entryFee:.01,exitFee:.02,fundingFee:0};
 const mocks={
  '../lib/prisma':{prisma:scenario.db??{testnetAccount:{update:async value=>{if(scenario.dbFailure)throw Error('db');writes.push(['account',value]);}}}},
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
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{exports,require:id=>{if(id==='node:crypto')return require(id);if(Object.hasOwn(mocks,id))return mocks[id];if(id.startsWith('../utils/'))return require(path.resolve(path.dirname(file),id+'.js'));throw Error('unmocked '+id);},process:{env:{BINANCE_ENABLED:scenario.enabled===false?'false':'true'}},Date,console:{log(){},warn(){},error(){}}},{filename:file});
 const position={position_id:'case',account_id:1,symbol:'BTC',side:scenario.short?'short':'long',entry_price:100,size_qty:scenario.realResolver?(scenario.short?-1:1)*(scenario.qty??.5):.01,partial_closed:scenario.partial?1:0,entry_time:new Date(now-3600000),account:{current_balance:scenario.realResolver?34.95:30},...(scenario.bookkeeping?{}:{binance_order_id:'entry'}),...(scenario.closed?{status:'closed'}:{}),...(scenario.position??{})};
 let outcome,error,timer;
 try{outcome=await Promise.race([scenario.concurrent?Promise.all([exports.closeLocalPosition(position,110,'manual_close'),exports.closeLocalPosition(position,110,'manual_close')]):exports.closeLocalPosition(position,110,scenario.bookkeeping?'reconciliation_bookkeeping':'manual_close'),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('blocked')),1000))]);}catch(e){error=e.message;}finally{clearTimeout(timer);}
 await Promise.resolve();await Promise.resolve();const json=v=>JSON.parse(JSON.stringify(v));return {outcome,error,writes:json(writes),events:json(events),effects:json(effects)};
}
(async()=>{
 const results=[];
 for(const [index,scenario]of [{realResolver:true,partial:true,concurrent:true},{realResolver:true,partial:true,short:true},{realResolver:true,partial:true,syncFailure:true},{realResolver:true,partial:false,qty:1},{realResolver:true,partial:true,rollback:true}].entries()){
  const account=await db.testnetAccount.create({data:{symbol:'BTC',method_id:'compiled_atomic_'+path.basename(pkg)+'_proof2_'+index,starting_balance:30,current_balance:34.95,equity:34.95}}),position_id='compiled-atomic-'+path.basename(pkg)+'-proof2-'+index;
  await db.testnetPosition.create({data:{position_id,account_id:account.id,symbol:'BTC',side:scenario.short?'short':'long',entry_price:100,stop_loss:scenario.short?110:90,take_profit:scenario.short?90:110,size_qty:(scenario.short?-1:1)*(scenario.qty??.5),size_usd:50,risk_usd:5,risk_percent:1,expected_rr:1,partial_closed:scenario.partial?1:0}});
  if(scenario.rollback){
   await db.$executeRawUnsafe('ALTER TABLE testnet_accounts ADD CONSTRAINT compiled_atomic_failure CHECK (id <> '+account.id+' OR total_trades < 1)');
   try {const failed=await run('release',{...scenario,db,position:{position_id,account_id:account.id}});assert(failed.error);assert.equal(failed.events.filter(e=>e[1]==='atomic_verified_close_committed').length,0);assert.equal((await db.testnetPosition.findUnique({where:{position_id}})).status,'open');assert.equal((await db.testnetAccount.findUnique({where:{id:account.id}})).total_trades,0);}finally{await db.$executeRawUnsafe('ALTER TABLE testnet_accounts DROP CONSTRAINT compiled_atomic_failure');}
  }
  const r=await run('release',{...scenario,db,position:{position_id,account_id:account.id}}),at=Date.now();assert.equal(r.error,undefined);
  if(scenario.concurrent){assert.equal(r.outcome.filter(n=>n===0).length,1);assert(r.outcome.some(n=>Math.abs(n-14.8)<1e-8));}else assert(Math.abs(r.outcome-14.8)<1e-8);
  const observed=r.events.map(([position_id,event_type,event_data],i)=>({id:i+1,position_id,event_type,event_data,timestamp:new Date(at).toISOString()}));
  const ledger=buildObservedCloseLedger(observed,at);assert(Math.abs(ledger.observed_net_close_subtotal-14.8)<1e-8);assert.equal(ledger.unknown_rows,0);
  const updated=await db.testnetAccount.findUnique({where:{id:account.id}});assert.equal(updated.total_trades,1);assert(Math.abs(updated.realized_pnl-14.8)<1e-8);assert.equal(updated.current_balance,34.95);
  assert.equal(observed.filter(e=>e.event_type==='atomic_verified_close_committed').length,1);
  results.push({scenario,net:updated.realized_pnl,trades:updated.total_trades,walletBalance:updated.current_balance,atomic_receipts:1,ledger,events:observed});
 }
 const report={compiledFillAndCloseHandlerWithRealIsolatedPrisma:true,productionTouched:false,rawExchangeFillsMocked:true,cases:results.length,results};fs.writeFileSync(path.join(pkg,'compiled-atomic-close-postgres-proof-v2.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({cases:results.length,accountAppliedOnce:true,ledgerMatches:true}));
})().catch(e=>{console.error(JSON.stringify({failed:true,code:e.code??'assertion',reason:e instanceof assert.AssertionError?e.message:'isolated_compiled_test_failed'}));process.exitCode=1;}).finally(()=>db.$disconnect());

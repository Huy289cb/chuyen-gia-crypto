require('tsx/cjs');const {buildObservedCloseLedger}=require('../src/utils/observed-close-ledger.ts');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const pkg=path.resolve(process.argv[2]),now=Date.now();
async function run(variant,scenario){
 const writes=[],events=[],effects=[],db={positionStatus:'open',accountNet:0,trades:0};const result={verified:scenario.verified??true,realizedPnl:scenario.pnl??-1,closePrice:110,source:'user_trades',tradeIds:[1,2],closeQty:.01,entryFee:.01,exitFee:.02,fundingFee:0};
 const ts=require('typescript'),repoPath=path.resolve(__dirname,'../dist/repositories/testnet.repository.js'),repoText=fs.readFileSync(repoPath,'utf8'),ast=ts.createSourceFile(repoPath,repoText,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='closeTestnetPosition');assert(fn);
 const actualClose=vm.runInNewContext('('+fn.getText(ast)+')',{Date,prisma_1:{prisma:{testnetPosition:{update:async arg=>{assert.equal(arg.where.position_id,'case');assert.equal(arg.where.status,undefined);db.positionStatus=arg.data.status;}}}}});
 const mocks={
  '../lib/prisma':{prisma:{testnetAccount:{update:async value=>{if(scenario.dbFailure)throw Error('db');writes.push(['account',value]);db.accountNet+=value.data.realized_pnl?.increment??0;db.trades+=value.data.total_trades?.increment??0;}}}},
  '../repositories/testnet.repository':{closeTestnetPosition:async(...args)=>{if(scenario.closeFailure)throw Error('close failed');await actualClose(...args);return writes.push(['close',...args]);},updateTestnetPosition:async(...args)=>{if(scenario.updateFailure)throw Error('update failed');return writes.push(['position',...args]);},recordTestnetTradeEvent:(...args)=>{events.push(args);if(args[1]==='close_account_update_applied'){if(scenario.journal==='failed')return Promise.reject(Error('journal'));if(scenario.journal==='pending')return new Promise(()=>{});}return Promise.resolve();}},
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
 const position={position_id:'case',account_id:1,symbol:'BTC',side:scenario.short?'short':'long',entry_price:100,size_qty:scenario.realResolver?(scenario.short?-1:1)*(scenario.qty??.5):.01,partial_closed:scenario.partial?1:0,entry_time:new Date(now-3600000),account:{current_balance:scenario.realResolver?34.95:30},...(scenario.bookkeeping?{}:{binance_order_id:'entry'}),...(scenario.closed?{status:'closed'}:{})};
 let outcome,error,timer;
 try{outcome=await Promise.race([exports.closeLocalPosition(position,110,scenario.bookkeeping?'reconciliation_bookkeeping':'manual_close'),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('blocked')),1000))]);if(scenario.repeatOpenSnapshot)await exports.closeLocalPosition(position,110,'manual_close');}catch(e){error=e.message;}finally{clearTimeout(timer);}
 await Promise.resolve();await Promise.resolve();const json=v=>JSON.parse(JSON.stringify(v));return {outcome,error,writes:json(writes),events:json(events),effects:json(effects),db};
}
(async()=>{
 const results=[];
 for(const scenario of [{realResolver:true,partial:false,qty:1,repeatOpenSnapshot:true},{realResolver:true,partial:true,repeatOpenSnapshot:true}]){
  const baseline=await run('baseline',scenario),release=await run('release',scenario);
  assert.equal(release.error,undefined);assert.equal(release.db.trades,2);assert(Math.abs(release.db.accountNet-29.6)<1e-8);assert.equal(release.db.positionStatus,'closed');
  results.push({scenario,baseline:baseline.db,release:release.db,accountWrites:release.writes.filter(w=>w[0]==='account').length});
 }
 const report={actualCompiledCloseServiceAndDeployedRepositoryFunction:true,dbExchangeMocked:true,staleOpenSnapshotCausesDuplicateStatistics:true,cases:results,liveOrdersSent:0};
 fs.writeFileSync(path.join(pkg,'compiled-stale-open-close-audit-v1.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});

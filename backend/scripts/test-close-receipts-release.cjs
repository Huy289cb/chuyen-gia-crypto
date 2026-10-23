const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const pkg=path.resolve(process.argv[2]),now=Date.parse('2026-10-02T12:45:00Z');
async function run(variant,scenario){
 const writes=[],events=[],effects=[];const result={verified:scenario.verified??true,realizedPnl:scenario.pnl??-1,closePrice:110,source:'user_trades',tradeIds:[1,2],closeQty:.01,entryFee:.01,exitFee:.02,fundingFee:0};
 const mocks={
  '../lib/prisma':{prisma:{testnetAccount:{update:async value=>{if(scenario.dbFailure)throw Error('db');writes.push(['account',value]);}}}},
  '../repositories/testnet.repository':{closeTestnetPosition:async(...args)=>{if(scenario.closeFailure)throw Error('close failed');return writes.push(['close',...args]);},updateTestnetPosition:async(...args)=>{if(scenario.updateFailure)throw Error('update failed');return writes.push(['position',...args]);},recordTestnetTradeEvent:(...args)=>{events.push(args);if(args[1]==='close_account_update_applied'){if(scenario.journal==='failed')return Promise.reject(Error('journal'));if(scenario.journal==='pending')return new Promise(()=>{});}return Promise.resolve();}},
  './binance-hedge-mode':{},'./binanceClient':{},
  './binance-balance-sync.service':{syncTestnetAccountFromBinance:async()=>effects.push('sync'),resolveTestnetAccountBalances:async()=>({account_balance:29,account_equity:29})},
  './trade-outcome.service':{recordTradeOutcomeOnClose:async(...args)=>effects.push(['outcome',...args])},
  './account-risk-guard.service':{applyConsecutiveLossCooldownIfNeeded:async(...args)=>effects.push(['cooldown',...args])},
  './binance-fill-pnl.service':{resolveClosePnlFromUserTrades:async()=>result},
  './close-reason-resolve.service':{resolveVerifiedCloseReason:reason=>reason},
 };
 const exports={},file=path.join(pkg,variant,'services/position-close.service.js');
 const fixedDate=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{exports,require:id=>{if(id==='node:crypto')return require(id);if(Object.hasOwn(mocks,id))return mocks[id];if(id.startsWith('../utils/'))return require(path.resolve(path.dirname(file),id+'.js'));throw Error('unmocked '+id);},process:{env:{BINANCE_ENABLED:scenario.enabled===false?'false':'true'}},Date:fixedDate,console:{log(){},warn(){},error(){}}},{filename:file});
 const position={position_id:'case',account_id:1,symbol:'BTC',side:'long',entry_price:100,size_qty:.01,entry_time:new Date(now-3600000),account:{current_balance:30},...(scenario.bookkeeping?{}:{binance_order_id:'entry'}),...(scenario.closed?{status:'closed'}:{})};
 let outcome,error,timer;
 try{outcome=await Promise.race([exports.closeLocalPosition(position,110,scenario.bookkeeping?'reconciliation_bookkeeping':'manual_close'),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('blocked')),1000))]);}catch(e){error=e.message;}finally{clearTimeout(timer);}
 await Promise.resolve();await Promise.resolve();const json=v=>JSON.parse(JSON.stringify(v));return {outcome,error,writes:json(writes),events:json(events),effects:json(effects)};
}
(async()=>{let replayed=0;const scenarios=[{}, {pnl:1},{pnl:0},{verified:false},{verified:false,enabled:false},{bookkeeping:true},{closed:true},{dbFailure:true},{journal:'failed'},{journal:'pending'},{closeFailure:true},{updateFailure:true}];
 const replay=require(path.join(pkg,'release/utils/recorded-close-account.js')).replayRecordedCloseAccount;
 for(const scenario of scenarios){const b=await run('baseline',scenario),r=await run('release',scenario);assert.equal(r.outcome,b.outcome);assert.equal(r.error,b.error);assert.deepEqual(r.writes,b.writes);assert.deepEqual(r.effects,b.effects);assert.deepEqual(r.events.filter(e=>e[1]!=='position_close_write_observed'),b.events);
  for(const e of r.events.filter(e=>e[1]==='position_close_write_observed')){const decoded=require(path.join(pkg,'release/utils/position-close-write-observation.js')).replayPositionCloseWrite(e[2],Date.now());assert.equal(decoded.status,e[2].outcome==='returned'?'local_close_contract_replayed':'unknown');}
  const journal=r.events.filter(e=>e[1]==='close_account_update_applied');assert.equal(journal.length,r.writes.filter(e=>e[0]==='account').length);
  for(const e of journal){const result=replay(e[2],now,now);assert.equal(result.status,'evaluated');assert.equal(result.matches_recorded,true);replayed++;}
 }
 assert.ok(replayed>0);const report={compiledServiceScenarios:scenarios.length,compiledJournalReplayCases:replayed,writeAndOutcomeAndExistingEventParity:true,failedDbHasNoAppliedJournal:true,journalFailureAndPendingNonblocking:true,liveOrdersSent:0,limits:'Mocked full close service only; no real persisted journal, exchange round cost or full portfolio parity.'};
 fs.writeFileSync(path.join(pkg,'compiled-close-receipts-parity.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});

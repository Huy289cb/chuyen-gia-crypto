const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const pkg=path.resolve(process.argv[2]),now=Date.parse('2026-10-02T12:45:00Z');
async function run(variant,scenario){
 const writes=[],events=[],effects=[];const result={verified:scenario.verified??true,realizedPnl:scenario.pnl??-1,closePrice:110,source:'user_trades',tradeIds:[1,2],closeQty:.01,entryFee:.01,exitFee:.02,fundingFee:0};
 const mocks={
  '../lib/prisma':{prisma:{testnetAccount:{update:async value=>{if(scenario.dbFailure)throw Error('db');writes.push(['account',value]);}}}},
  '../repositories/testnet.repository':{closeTestnetPosition:async(...args)=>writes.push(['close',...args]),updateTestnetPosition:async(...args)=>writes.push(['position',...args]),recordTestnetTradeEvent:(...args)=>{events.push(args);if(['close_account_update_applied','close_round_query_observed','wallet_sync_observed'].includes(args[1])){if(scenario.journal==='failed')return Promise.reject(Error('journal'));if(scenario.journal==='pending')return new Promise(()=>{});}return Promise.resolve();}},
  './binance-hedge-mode':{},'./binanceClient':{},
  './binance-balance-sync.service':{syncTestnetAccountFromBinance:async(_id,observer)=>{effects.push('sync');if(observer)observer({schema:'wallet-sync-v1',account_id:1,requested_at:new Date(now).toISOString(),received_at:new Date(now).toISOString(),applied_at:new Date(now).toISOString(),source:'normalized_account_api',status:'applied',snapshot:{walletBalance:30,equity:30,unrealizedPnl:0},update:{current_balance:30,equity:30,unrealized_pnl:0,updated_at:new Date(now).toISOString()}});},resolveTestnetAccountBalances:async()=>({account_balance:29,account_equity:29})},
  './trade-outcome.service':{recordTradeOutcomeOnClose:async(...args)=>effects.push(['outcome',...args])},
  './account-risk-guard.service':{applyConsecutiveLossCooldownIfNeeded:async(...args)=>effects.push(['cooldown',...args])},
  './binance-fill-pnl.service':{resolveClosePnlFromUserTrades:async params=>{if(params.onEvidence)params.onEvidence({schema:'fixture-query-observation'});return result;}},
  './close-reason-resolve.service':{resolveVerifiedCloseReason:reason=>reason},
 };
 const exports={},file=path.join(pkg,variant,'services/position-close.service.js');
 const fixedDate=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{exports,require:id=>{if(Object.hasOwn(mocks,id))return mocks[id];if(id.startsWith('../utils/'))return require(path.resolve(path.dirname(file),id+'.js'));throw Error('unmocked '+id);},process:{env:{BINANCE_ENABLED:scenario.enabled===false?'false':'true'}},Date:fixedDate,console:{log(){},warn(){},error(){}}},{filename:file});
 const position={position_id:'case',account_id:1,symbol:'BTC',side:'long',entry_price:100,size_qty:.01,entry_time:new Date(now-3600000),account:{current_balance:30},...(scenario.bookkeeping?{}:{binance_order_id:'entry'}),...(scenario.closed?{status:'closed'}:{})};
 let outcome,error,timer;
 try{outcome=await Promise.race([exports.closeLocalPosition(position,110,scenario.bookkeeping?'reconciliation_bookkeeping':'manual_close'),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('blocked')),1000))]);}catch(e){error=e.message;}finally{clearTimeout(timer);}
 await Promise.resolve();await Promise.resolve();const json=v=>JSON.parse(JSON.stringify(v));return {outcome,error,writes:json(writes),events:json(events),effects:json(effects)};
}
(async()=>{let replayed=0,queryEvents=0;const scenarios=[{}, {pnl:1},{pnl:0},{verified:false},{verified:false,enabled:false},{bookkeeping:true},{closed:true},{dbFailure:true},{journal:'failed'},{journal:'pending'}];
 const replay=require(path.join(pkg,'release/utils/recorded-close-account.js')).replayRecordedCloseAccount;
 for(const scenario of scenarios){const b=await run('baseline',scenario),r=await run('release',scenario);assert.equal(r.outcome,b.outcome);assert.equal(r.error,b.error);assert.deepEqual(r.writes,b.writes);assert.deepEqual(r.effects,b.effects);const strip=e=>e.map(item=>item[1]==='close_account_update_applied'?[item[0],item[1],Object.fromEntries(Object.entries(item[2]).filter(([key])=>key!=='applied_clock_source'))]:item);assert.deepEqual(strip(r.events),strip(b.events));
  const wallets=r.events.filter(e=>e[1]==='wallet_sync_observed');assert.equal(wallets.length,scenario.enabled===false||scenario.closed||scenario.dbFailure?0:1);for(const e of wallets){const result=require(path.join(pkg,'release/utils/recorded-wallet-sync.js')).replayRecordedWalletSync(e[2],now,now);assert.equal(result.status,'evaluated');assert.equal(result.matches_recorded,true);}
  const queryJournal=r.events.filter(e=>e[1]==='close_round_query_observed');queryEvents+=queryJournal.length;assert.equal(queryJournal.length,scenario.closed||scenario.bookkeeping?0:1);for(const event of queryJournal)assert.deepEqual(event[2],{schema:'fixture-query-observation'});
  const journal=r.events.filter(e=>e[1]==='close_account_update_applied');assert.equal(journal.length,r.writes.filter(e=>e[0]==='account').length);
  for(const e of journal){const result=replay(e[2],now,now);assert.equal(result.status,'evaluated');assert.equal(result.matches_recorded,true);assert.equal(result.application_ordering,'db_return_observed');assert.equal(e[2].applied_clock_source,'db_update_return');replayed++;}
 }
 assert.ok(replayed>0);const report={accountDbReturnClockTagged:true,compiledServiceScenarios:scenarios.length,queryJournalEventChecks:queryEvents,compiledJournalReplayCases:replayed,writeAndOutcomeAndExistingEventParity:true,failedDbHasNoAppliedJournal:true,journalFailureAndPendingNonblocking:true,liveOrdersSent:0,limits:'Mocked full close service/callback only; fixture observer/wallet payloads only, no full portfolio parity.'};
 fs.writeFileSync(process.argv[3]??path.join(pkg,'compiled-close-integration.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});

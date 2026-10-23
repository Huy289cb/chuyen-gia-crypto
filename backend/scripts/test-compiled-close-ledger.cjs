require('tsx/cjs');const {buildObservedCloseLedger}=require('../src/utils/observed-close-ledger.ts');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const pkg=path.resolve(process.argv[2]),now=Date.now();
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
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{exports,require:id=>{if(id==='node:crypto')return require(id);if(Object.hasOwn(mocks,id))return mocks[id];if(id.startsWith('../utils/'))return require(path.resolve(path.dirname(file),id+'.js'));throw Error('unmocked '+id);},process:{env:{BINANCE_ENABLED:scenario.enabled===false?'false':'true'}},Date,console:{log(){},warn(){},error(){}}},{filename:file});
 const position={position_id:'case',account_id:1,symbol:'BTC',side:'long',entry_price:100,size_qty:.01,entry_time:new Date(now-3600000),account:{current_balance:30},...(scenario.bookkeeping?{}:{binance_order_id:'entry'}),...(scenario.closed?{status:'closed'}:{})};
 let outcome,error,timer;
 try{outcome=await Promise.race([exports.closeLocalPosition(position,110,scenario.bookkeeping?'reconciliation_bookkeeping':'manual_close'),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('blocked')),1000))]);}catch(e){error=e.message;}finally{clearTimeout(timer);}
 await Promise.resolve();await Promise.resolve();const json=v=>JSON.parse(JSON.stringify(v));return {outcome,error,writes:json(writes),events:json(events),effects:json(effects)};
}
(async()=>{
 const scenarios=[{}, {pnl:1},{pnl:0},{verified:false},{verified:false,enabled:false},{bookkeeping:true},{dbFailure:true},{journal:'failed'},{journal:'pending'},{closeFailure:true},{updateFailure:true}];
 const results=[];
 for(const scenario of scenarios){
  const r=await run('release',scenario),at=Date.now();
  const events=r.events.map(([position_id,event_type,event_data],i)=>({id:i+1,position_id,event_type,event_data,timestamp:new Date(at).toISOString()}));
  const ledger=buildObservedCloseLedger(events,at);
  const hasFinancial=events.some(e=>e.event_type==='position_close_write_observed'&&e.event_data.kind==='close_financial_update'&&e.event_data.outcome==='returned');
  const eligible=hasFinancial&&events.some(e=>e.event_type==='close_account_update_applied')&&!scenario.bookkeeping&&scenario.verified!==false;
  if(eligible){assert.equal(ledger.observed_net_close_subtotal,scenario.pnl??-1);assert.equal(ledger.unknown_rows,0);}else assert.equal(ledger.observed_net_close_subtotal,null);
  assert.equal(ledger.economic_roi_base,null);
  results.push({scenario,eligible,events,ledger,error:r.error??null});
 }
 const report={compiledProducerCases:results.length,source:'sealed compiled close service release; DB/exchange mocked',actualPublishedPayloadLedgerChecked:true,liveOrdersSent:0,results};
 fs.writeFileSync(path.join(pkg,process.argv[3]??'compiled-close-ledger-integration-v1.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({cases:results.length,eligible:results.filter(r=>r.eligible).length}));
})().catch(e=>{console.error(e);process.exitCode=1;});

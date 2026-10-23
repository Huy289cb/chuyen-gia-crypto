const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const pkg=path.resolve(process.argv[2]);
async function run(variant,scenario){
 const calls=[],events=[],modules=new Map();
 const mocks={
  '../config/risk-policy':{getRiskPolicy:()=>({minSlDistancePercent:.008})},
  '../repositories/testnet.repository':{updateTestnetPosition:async(...args)=>calls.push(['update',...args]),recordTestnetTradeEvent:(...args)=>{events.push(JSON.parse(JSON.stringify(args)));if(scenario.journal==='failed')return Promise.reject(Error('journal'));if(scenario.journal==='pending')return new Promise(()=>{});return Promise.resolve();}},
  './binanceClient':{placeStopLossOrder:async(...args)=>{calls.push(['sl',...args]);return {orderId:'sl1'};},placeTakeProfitOrder:async(...args)=>{calls.push(['tp',...args]);return {orderId:'tp1'};}},
  './binance-hedge-mode':{ensurePositionModeDetected:async()=>{},getPositionMode:()=> 'ONE_WAY'},
  './binance-exposure.service':{fetchBinanceNetPosition:async()=>{if(scenario.mark==='failed')throw Error('mark');return scenario.mark==='missing'?null:{markPrice:100};}},
  './position-close.service':{closeLocalPosition:()=>{throw Error('unexpected close');},closePositionOnBinanceMarket:()=>{throw Error('unexpected close');}},
  './telegram/telegram-notify.service':{notifyAlert:()=>{}},
 };
 function load(file){
  if(modules.has(file))return modules.get(file).exports;
  const m=new Module(file,module);m.filename=file;modules.set(file,m);
  m.require=id=>{if(Object.hasOwn(mocks,id))return mocks[id];if(id.startsWith('../utils/'))return load(path.resolve(path.dirname(file),id+'.js'));if(id.startsWith('./')&&path.dirname(file).endsWith('/utils'))return load(path.resolve(path.dirname(file),id+'.js'));throw Error('unmocked dependency '+id);};
  m._compile(fs.readFileSync(file,'utf8'),file);return m.exports;
 }
 const service=load(path.join(pkg,variant,'services/protective-order.service.js'));
 const side=scenario.side??'long';
 const position={position_id:'case',symbol:'BTC',side,entry_price:100,size_qty:.01,stop_loss:side==='long'?90:110,take_profit:side==='long'?110:90};
 let timer;const outcome=await Promise.race([service.placeProtectiveOrdersForPosition(position),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('placement blocked')),1000);})]).finally(()=>clearTimeout(timer));
 await Promise.resolve();await Promise.resolve();
 return {outcome,calls,events};
}
(async()=>{
 let replayed=0;const scenarios=[{mark:'observed'},{mark:'missing'},{mark:'failed'},{mark:'observed',journal:'failed'},{mark:'observed',journal:'pending'},{mark:'observed',side:'short'}];
 const replay=require(path.join(pkg,'release/utils/recorded-protective-action.js')).replayRecordedProtectiveAction;
 for(const scenario of scenarios){
  const b=await run('baseline',scenario),r=await run('release',scenario);
  assert.equal(r.outcome,b.outcome);assert.deepEqual(r.calls,b.calls);assert.equal(r.outcome,'ok');
  const actions=r.events.filter(e=>e[1]==='protective_action_evaluated');assert.equal(actions.length,2);
  assert.deepEqual(actions.map(e=>e[2].stage),['planned','recomputed']);
  for(const e of actions){const result=replay(e[2]);if(scenario.mark==='observed'){assert.equal(result.status,'evaluated');assert.equal(result.matches_recorded,true);}else{assert.equal(result.status,'unknown');assert.equal(e[2].mark_status,scenario.mark);}replayed++;}
 }
 const report={compiledScenarios:scenarios.length,actionJournalChecks:replayed,exchangeAndDbWriteIntentParity:true,pendingAndFailedTelemetryNonblocking:true,liveOrdersSent:0,limits:'Mocked compiled component; no real exchange acknowledgement or portfolio parity.'};
 fs.writeFileSync(path.join(pkg,'compiled-integration.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
})().catch(error=>{console.error(error);process.exitCode=1;});

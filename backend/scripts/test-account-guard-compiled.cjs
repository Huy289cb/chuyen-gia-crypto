'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const packageRoot=process.argv[3]?path.resolve(process.argv[3]):null;
const compile=file=>packageRoot?fs.readFileSync(path.join(packageRoot,'release',file.replace(/\.ts$/,'.js')),'utf8'):ts.transpileModule(fs.readFileSync(path.join(root,'src',file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const helperModule={exports:{}};
vm.runInNewContext(compile('utils/account-initial-guard.ts'),{exports:helperModule.exports,module:helperModule});
const replayModule={exports:{}};
vm.runInNewContext(compile('utils/recorded-account-guard-mutation.ts'),{exports:replayModule.exports,module:replayModule,require:id=>{assert.equal(id,'./account-initial-guard');return helperModule.exports;}});
const baseline=fs.readFileSync(path.join(packageRoot?path.join(packageRoot,'baseline'):path.join(root,'dist'),'services/account-risk-guard.service.js'),'utf8');
const candidate=compile('services/account-risk-guard.service.ts');
const cutoff=Date.parse('2026-10-03T00:00:00Z');
class Clock extends Date {constructor(...args){super(...(args.length?args:[cutoff]));}static now(){return cutoff;}}
async function run(code,fixture){
 const writes=[],events=[];
 const account={id:1,current_balance:30,equity:30,consecutive_losses:0,cooldown_until:null,...fixture.account};
 const policy={maxConsecutiveLosses:2,lossCooldownTier2MinStreak:2,dailyLossLimitPercent:10};
 const dependencies={
 '../lib/prisma':{prisma:{testnetAccount:{findUnique:async()=>fixture.missingAccount?null:account,update:async v=>{if(fixture.dbFailure)throw Error('write failed');writes.push(JSON.parse(JSON.stringify(v)));}}}},
 '../config/risk-policy':{getRiskPolicy:()=>policy,resolveLossCooldownUntil:()=>fixture.lossCooldown?new Clock(cutoff+60000):null},
 '../repositories/testnet.repository':{setTestnetAccountCooldown:async()=>{}},
 './binance-trade-history.service':{getBinanceLossStreak:async()=>{if(fixture.exchangeFailure)throw Error('exchange unavailable');return fixture.streak??{consecutiveLosses:0,lastLossTime:0};}},
 './protective-exposure-state':{getProtectiveExposureEntryBlock:()=>fixture.block??null},
 './account-circuit.service':{getAccountCircuitStatus:async()=>({allowed:!fixture.circuitBlock,reason:fixture.circuitBlock?'circuit blocked':'clear',startEquity:30,dailyLossUsd:0}),applyExpectancyKillCooldownIfNeeded:async()=>{}},
 '../utils/entry-trace':{recordEntryStage:async()=>{}},
 '../utils/account-initial-guard':helperModule.exports,
 '../utils/account-wallet-journal':{persistAccountWalletObservation:async(event,type)=>{events.push({event,type});if(fixture.journalPending)return new Promise(()=>{});if(fixture.journalFailure)throw Error('journal failed');}},
 'node:crypto':{randomUUID:()=> '00000000-0000-4000-8000-000000000001'}
 };
 const mod={exports:{}};
 vm.runInNewContext(code,{module:mod,exports:mod.exports,Date:Clock,process:{env:{BINANCE_ENABLED:'true'}},console:{warn:()=>{},log:()=>{}},require:id=>{if(!(id in dependencies))throw Error('unexpected dependency '+id);return dependencies[id];}});
 let result;
 try{result=await mod.exports.assertTestnetAccountCanOpenTrade(1,'BTC');}catch(e){result={error:e.message};}
 await Promise.resolve();await Promise.resolve();
 return {result:JSON.parse(JSON.stringify(result)),writes,events};
}
(async()=>{
 let cases=0,journals=0;
 for(const cooldown of [null,new Date(cutoff-1),new Date(cutoff),new Date(cutoff+1)])
 for(const block of [null,{reason:'missing SL'}])
 for(const loss of [0,1,2]){
  const fixture={account:{cooldown_until:cooldown},block,streak:{consecutiveLosses:loss,lastLossTime:0}};
  const old=await run(baseline,fixture),next=await run(candidate,fixture);
  assert.deepEqual(next.result,old.result);assert.deepEqual(next.writes,old.writes);
  for(const {event,type}of next.events){assert.equal(type,'account_guard_mutation_applied');assert.equal(event.applied_clock_source,'db_update_return');assert.equal(event.applied_at,new Date(cutoff).toISOString());const replay=replayModule.exports.replayRecordedAccountGuardMutation(event,cutoff,cutoff);assert.equal(replay.status,'evaluated');assert.equal(replay.matches_recorded,true);journals++;}
  cases++;
 }
 for(const option of ['dbFailure','journalPending','journalFailure']){
  const fixture={account:{cooldown_until:new Date(cutoff-1)},[option]:true};
  const old=await run(baseline,fixture),next=await run(candidate,fixture);
  assert.deepEqual(next.result,old.result);assert.deepEqual(next.writes,old.writes);
  if(option==='dbFailure')assert.equal(next.events.length,0);
  cases++;
 }
 for(const fixture of [{missingAccount:true},{circuitBlock:true},{exchangeFailure:true,account:{consecutive_losses:2}},{lossCooldown:true,streak:{consecutiveLosses:2,lastLossTime:cutoff-1}}]){
  const old=await run(baseline,fixture),next=await run(candidate,fixture);
  assert.deepEqual(next.result,old.result);assert.deepEqual(next.writes,old.writes);cases++;
 }
 const report={schema:'account-guard-compiled-parity-v1',cases,journals,payloadReplays:journals,passed:true,runtimeDeployed:false,limits:'Service-only fixtures; no full engine, exchange ledger, costs or ROI proof.'};
 const output=process.argv[2];if(!output)throw Error('exclusive report path required');
 fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.message);process.exitCode=1;});

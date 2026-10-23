'use strict';
// Zero-provider regression tests of handlers executed inside the runtime VM.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const legacy=require('./production-portfolio-runtime.cjs').createProductionPortfolioRuntime;
const strict=require('./production-portfolio-runtime-strict-db.cjs').createProductionPortfolioRuntime;
const frozen='d58d5232755749f3b3a08b019b5c050293e063d69df82e0a8f56d8e247fd5166';
const hash=()=>crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'production-portfolio-runtime.cjs'))).digest('hex');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'strict-db-boundary-'));
fs.mkdirSync(path.join(root,'services'));
fs.writeFileSync(path.join(root,'services/binance-balance-sync.service.js'),`
const {prisma}=require('../lib/prisma');
exports.syncAllTestnetAccountsFromBinance=async()=>{
 await prisma.testnetAccount.update({where:{id:'a'},data:{equity:32}});
 try {
  if(process.env.SCENARIO==='raw')await prisma.$executeRaw('mock-only');
  else if(process.env.SCENARIO==='success')return await prisma.$transaction(async tx=>{await tx.testnetAccount.update({where:{id:'a'},data:{equity:34}});return 7;});
  else await prisma.testnetTradeEvent.create({data:{id:'failure'}});
 }catch(error){console.error('caught mock database failure',error.message);return {caught:true};}
};
`);
let providers=0,passed=0;
const at=1738867625000;
function fixture(factory,scenario,journalEnabled){
 const state={id:'a',equity:31},calls={begin:0,complete:0,tx:0,handlerWrites:0};let checkpoint;
 const failure=()=>Object.assign(Error('mock caught database failure'),{code:'P2028'});
 const database={
  testnetAccount:{findMany:async()=>[{...state}],update:async({data})=>{calls.handlerWrites++;Object.assign(state,data);return {...state};}},
  testnetPosition:{findMany:async()=>[]},testnetPendingOrder:{findMany:async()=>[]},
  testnetTradeEvent:{create:()=>{if(scenario==='sync')throw failure();return Promise.reject(failure());}},
  $executeRaw:()=>{throw failure();},
  $transaction:async work=>{calls.tx++;return work(database);}
 };
 const journal={begin:async()=>{calls.begin++;return 'mock-command';},complete:async value=>{calls.complete++;checkpoint=value;}};
 const runtime=factory({runtimeRoot:root,database,environment:{SCENARIO:scenario},externalAdapters:{providerFetch:()=>{providers++;throw Error('provider forbidden');}},initialClock:at-1,...(journalEnabled?{commandJournal:journal}:{})});
 return {runtime,calls,getCheckpoint:()=>checkpoint};
}
async function check(name,work){await work();passed++;console.log('PASS '+name);}
(async()=>{
 assert.equal(hash(),frozen);
 await check('legacy admits an asynchronous database failure caught inside VM handler',async()=>{
  const f=fixture(legacy,'async',true);const result=await f.runtime.step({kind:'balance_sync',at});assert.equal(result.result.caught,true);assert.equal(f.calls.complete,1);assert.equal(f.runtime.diagnostics().database_errors.length,1);
 });
 await check('strict refuses journal completion, preserves partial snapshot and error context',async()=>{
  const f=fixture(strict,'async',true);await assert.rejects(f.runtime.step({kind:'balance_sync',at}),/runtime_database_integrity_failure/);assert.equal(f.calls.begin,1);assert.equal(f.calls.complete,0);
  const d=f.runtime.diagnostics(),e=d.database_errors[0];assert.equal(e.code,'P2028');assert.equal(e.command_sequence,1);assert.equal(e.command_kind,'balance_sync');assert.equal(e.at,at);assert.equal(d.database_boundary_failure.command_sequence,1);
  assert.equal((await f.runtime.snapshot()).accounts[0].equity,32);await assert.rejects(f.runtime.step({kind:'balance_sync',at:at+1}),/runtime_database_integrity_failure/);assert.equal(f.calls.begin,1);assert.equal(f.calls.handlerWrites,1);assert.equal((await f.runtime.snapshot()).accounts[0].equity,32);
 });
 await check('strict refuses the next command without any journal',async()=>{
  const f=fixture(strict,'async',false);await assert.rejects(f.runtime.step({kind:'balance_sync',at}),/runtime_database_integrity_failure/);await assert.rejects(f.runtime.step({kind:'balance_sync',at:at+1}),/runtime_database_integrity_failure/);assert.equal(f.calls.handlerWrites,1);assert.equal((await f.runtime.snapshot()).accounts[0].equity,32);
 });
 for(const scenario of ['sync','raw'])await check('strict catches '+scenario+' synchronous database failure in VM handler',async()=>{
  const f=fixture(strict,scenario,false);await assert.rejects(f.runtime.step({kind:'balance_sync',at}),/runtime_database_integrity_failure/);assert.equal(f.runtime.diagnostics().database_errors[0].command_sequence,1);await assert.rejects(f.runtime.step({kind:'balance_sync',at:at+1}),/runtime_database_integrity_failure/);
 });
 await check('success preserves transaction return, commit audit and subsequent commands',async()=>{
  const f=fixture(strict,'success',true);const result=await f.runtime.step({kind:'balance_sync',at});assert.equal(result.result,7);assert.equal(result.state.accounts[0].equity,34);assert.equal(f.calls.tx,1);assert.equal(f.calls.complete,1);assert.equal(f.getCheckpoint().transactions[0].status,'committed');assert.equal(f.getCheckpoint().operations.find(x=>x.transaction_id===0).result.equity,34);assert.equal(f.runtime.diagnostics().database_errors.length,0);await f.runtime.step({kind:'balance_sync',at:at+1});assert.equal(f.calls.complete,2);
 });
 assert.equal(providers,0);assert.equal(hash(),frozen);console.log(JSON.stringify({passed,provider_calls:providers,legacy_sha256:hash()}));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));

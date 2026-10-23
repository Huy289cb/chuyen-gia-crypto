'use strict';
// Focused SQL snapshot boundary tests: actual VM loader, mocked storage, zero providers.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createProductionPortfolioRuntime}=require('./production-portfolio-runtime-strict-db-sql-snapshot.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'strict-db-sql-'));
fs.mkdirSync(path.join(root,'services'));
fs.writeFileSync(path.join(root,'services/binance-balance-sync.service.js'),"const {prisma}=require('../lib/prisma');exports.syncAllTestnetAccountsFromBinance=async()=>{return await prisma.testnetAccount.update({where:{id:1},data:{equity:32}});};\n");
const at=1738867625000;let passed=0,providers=0;
function fixture({failAt,journal=true,malformed=false}={}){
 let queries=0,recovered=false,begins=0,completes=0,writes=0,lastSql;
 const account={id:1,equity:31,updated_at:'2025-02-06T12:07:05.000'};
 const field=(name,type)=>({name,type,kind:'scalar',isRequired:true});
 const database={
  _runtimeDataModel:{models:{TestnetAccount:{fields:[field('id','Int'),field('equity','Float'),field('updated_at','DateTime')]},TestnetPosition:{fields:[field('id','Int')]},TestnetPendingOrder:{fields:[field('id','Int')]}}},
  $transaction:async work=>work(database),
  $queryRawUnsafe:async sql=>{queries++;lastSql=sql;if(queries===failAt&&!recovered){if(malformed)return[{accounts:null,positions:[],pending:[]}];throw Object.assign(Error('mock SQL snapshot read failure'),{code:'P2028'});}return[{accounts:[{...account}],positions:[],pending:[]}];},
  testnetAccount:{update:async({data})=>{writes++;Object.assign(account,data);return{...account};},findMany:()=>{throw Error('ORM snapshot regression');}},
  testnetPosition:{findMany:()=>{throw Error('ORM snapshot regression');}},testnetPendingOrder:{findMany:()=>{throw Error('ORM snapshot regression');}}
 };
 const runtime=createProductionPortfolioRuntime({runtimeRoot:root,storageSchema:'engine_strict_sql_fixture',database,environment:{},initialClock:at-1,externalAdapters:{providerFetch:()=>{providers++;throw Error('provider forbidden');}},...(journal?{commandJournal:{begin:async()=>{begins++;return 'key';},complete:async()=>{completes++;}}}:{})});
 return {runtime,recover:()=>{recovered=true;},facts:()=>({queries,begins,completes,writes,lastSql})};
}
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
async function assertLatched(f){const d=f.runtime.diagnostics(),e=d.database_errors[0];assert.equal(e.command_sequence,1);assert.equal(e.command_kind,'balance_sync');assert.equal(e.at,at);const calls=f.facts().queries;await assert.rejects(f.runtime.step({kind:'balance_sync',at:at+1}),/runtime_database_integrity_failure/);assert.equal(f.facts().queries,calls);f.recover();assert.ok((await f.runtime.snapshot()).accounts[0].updated_at instanceof Date);assert.equal(d.database_boundary_failure.command_sequence,1);}
(async()=>{
 await check('before-command SQL failure records intended command and refuses later step',async()=>{const f=fixture({failAt:1});await assert.rejects(f.runtime.step({kind:'balance_sync',at}),/mock SQL snapshot read failure/);assert.equal(f.facts().begins,0);assert.equal(f.facts().writes,0);assert.equal(f.facts().completes,0);assert.equal(f.runtime.diagnostics().database_errors[0].code,'P2028');await assertLatched(f);});
 await check('after-VM-handler SQL failure refuses journal completion and preserves partial state',async()=>{const f=fixture({failAt:2});await assert.rejects(f.runtime.step({kind:'balance_sync',at}),/mock SQL snapshot read failure/);assert.equal(f.facts().begins,1);assert.equal(f.facts().writes,1);assert.equal(f.facts().completes,0);await assertLatched(f);assert.equal((await f.runtime.snapshot()).accounts[0].equity,32);assert.ok(f.runtime.diagnostics().loaded_runtime_hashes['services/binance-balance-sync.service.js']);});
 await check('SQL failure latches without journal',async()=>{const f=fixture({failAt:1,journal:false});await assert.rejects(f.runtime.step({kind:'balance_sync',at}),/mock SQL snapshot read failure/);assert.equal(f.facts().writes,1);await assertLatched(f);assert.equal((await f.runtime.snapshot()).accounts[0].equity,32);});
 await check('snapshot validation error is retained as integrity failure',async()=>{const f=fixture({failAt:2,malformed:true});await assert.rejects(f.runtime.step({kind:'balance_sync',at}),/snapshot_array_missing:accounts/);assert.equal(f.facts().completes,0);await assertLatched(f);});
 await check('success uses unchanged one-statement SQL snapshot and actual strict VM handler',async()=>{const f=fixture();const r=await f.runtime.step({kind:'balance_sync',at});assert.equal(r.result.equity,32);assert.equal(r.state.accounts[0].equity,32);assert.ok(r.state.accounts[0].updated_at instanceof Date);assert.equal(f.facts().queries,2);assert.equal(f.facts().completes,1);assert.match(f.facts().lastSql,/"engine_strict_sql_fixture"\."testnet_accounts"/);assert.equal((f.facts().lastSql.match(/jsonb_agg/g)||[]).length,3);assert.equal(f.runtime.diagnostics().database_errors.length,0);await f.runtime.step({kind:'balance_sync',at:at+1});assert.equal(f.facts().completes,2);});
 assert.equal(providers,0);console.log(JSON.stringify({passed,provider_calls:providers}));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));

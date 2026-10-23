const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),ts=require('typescript'),vm=require('node:vm');
const pkg=path.resolve(process.argv[2]),m=JSON.parse(fs.readFileSync(path.join(pkg,'manifest.json'))),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.deepEqual(m.changedFiles,['services/binance-balance-sync.service.js','utils/account-wallet-journal.js','utils/recorded-account-wallet.js']);
for(const variant of ['baseline','release'])for(const[f,h]of Object.entries(m[variant]))assert.equal(sha(fs.readFileSync(path.join(pkg,variant,f))),h);
const printer=ts.createPrinter({removeComments:true});
for(const file of ['services/binance-balance-sync.service.js']){
 const prints=[];for(const variant of ['baseline','release']){const sf=ts.createSourceFile(file,fs.readFileSync(path.join(pkg,variant,file),'utf8'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
 const transformed=ts.transform(sf,[ctx=>root=>{function visit(n){
 if(ts.isVariableStatement(n)&&n.declarationList.declarations.length===1){
 const d=n.declarationList.declarations[0],name=d.name.getText(sf);
 if(name==='node_crypto_1'||name==='syncAttemptId')return undefined;
 if(name==='emit')return ts.factory.updateVariableStatement(n,n.modifiers,ts.factory.createVariableDeclarationList([ts.factory.updateVariableDeclaration(d,d.name,d.exclamationToken,d.type,ts.factory.createIdentifier('verifiedTelemetryEmitter'))],n.declarationList.flags));
 }
 return ts.visitEachChild(n,visit,ctx);
 }return ts.visitNode(root,visit);}]);prints.push(printer.printFile(transformed.transformed[0]));transformed.dispose();
 }if(prints[0]!==prints[1])throw Error('outside wallet sync/observer AST differs '+file);
}
const now=Date.parse('2026-10-02T13:10:00Z');
async function run(variant,scenario){let queries=0,writes=[],events=[],journals=[];const file=path.join(pkg,variant,'services/binance-balance-sync.service.js'),exports={};
 const fixedDate=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 const mocks={'node:crypto':{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},'../utils/account-wallet-journal':{persistAccountWalletObservation:async e=>{journals.push(JSON.parse(JSON.stringify(e)));if(scenario.journalFailed)throw Error('journal');if(scenario.journalPending)return new Promise(()=>{});}},'../lib/prisma':{prisma:{testnetAccount:{update:async value=>{if(scenario.dbFailure)throw Error('db failed');writes.push(value);}}}},'./binance/account':{getAccount:async()=>{queries++;if(scenario.queryError){const e=Error('query failed');e.binanceCode=scenario.queryError;throw e;}return {assets:scenario.fallback?[]:[{asset:'USDT',walletBalance:scenario.wallet??30}],totalWalletBalance:31,totalUnrealizedProfit:1,totalMarginBalance:32};}},'./binance-account-health.service':{isBinanceDemoMetadataUnavailableError:e=>e.binanceCode===-1109}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{exports,require:id=>{if(Object.hasOwn(mocks,id))return mocks[id];if(id.startsWith('../utils/'))return require(path.resolve(path.dirname(file),id+'.js'));throw Error(id);},Date:fixedDate,process:{env:{}},console:{log(){},warn(){}}},{filename:file});
 let result,error;try{result=await exports.syncTestnetAccountFromBinance(1,scenario.noObserver?undefined:e=>{events.push(JSON.parse(JSON.stringify(e)));if(scenario.observerThrows)throw Error('observer');});}catch(e){error=e.message;}
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 return {journals,result:result===undefined?undefined:JSON.parse(JSON.stringify(result)),error,queries,writes:JSON.parse(JSON.stringify(writes)),events};
}
(async()=>{let replayed=0;const scenarios=[{}, {wallet:0},{fallback:true},{queryError:-1109},{queryError:-1},{dbFailure:true},{observerThrows:true},{noObserver:true},{journalFailed:true},{journalPending:true}];
 const replay=require(path.join(pkg,'release/utils/recorded-wallet-sync.js')).replayRecordedWalletSync;
 for(const scenario of scenarios){const b=await run('baseline',scenario),r=await run('release',scenario);assert.equal(r.error,b.error);assert.equal(r.queries,b.queries);assert.deepEqual(r.result,b.result);assert.deepEqual(r.writes,b.writes);
 if(scenario.dbFailure||scenario.noObserver)assert.equal(r.events.length,0);else assert.equal(r.events.length,1);
 assert.equal(r.journals.length,scenario.dbFailure?0:1);for(const journal of r.journals){assert.equal(journal.sync_attempt_id,'00000000-0000-4000-8000-000000000001');const checked=require(path.join(pkg,'release/utils/recorded-account-wallet.js')).replayAccountWalletJournal([{id:1,event_type:'account_wallet_sync_observed',timestamp:new Date(now).toISOString(),event_data:journal}],now);assert.equal(checked.rows[0].status,journal.status==='applied'?'evaluated':'unknown');if(journal.status==='applied')assert.equal(checked.rows[0].matches_recorded,true);}
 for(const e of r.events){const result=replay(e,now,now);assert.equal(result.status,e.status==='applied'?'evaluated':'unknown');if(result.status==='evaluated'){assert.equal(result.matches_recorded,true);replayed++;}}
 }
 const report={allPackageHashesVerified:true,modulesOutsideSyncAndCallbackMatch:true,accountJournalChecks:true,journalFailureAndPendingNonblocking:true,compiledSyncScenarios:scenarios.length,queryResultAndWriteParity:true,compiledWalletPayloadReplays:replayed,noAppliedEventOnFailedDb:true,observerExceptionNonblocking:true,liveQueries:0,limits:'Mocked wallet component only, not raw asset or full close-service/portfolio proof.'};fs.writeFileSync(process.argv[3]??path.join(pkg,'compiled-tests.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});

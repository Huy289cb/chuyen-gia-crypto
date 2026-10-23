const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),ts=require('typescript'),vm=require('node:vm');
const pkg=path.resolve(process.argv[2]),m=JSON.parse(fs.readFileSync(path.join(pkg,'manifest.json'))),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.deepEqual(m.changedFiles,['services/binance-balance-sync.service.js','services/position-close.service.js','utils/recorded-wallet-sync.js','utils/wallet-sync-update.js']);
for(const variant of ['baseline','release'])for(const[f,h]of Object.entries(m[variant]))assert.equal(sha(fs.readFileSync(path.join(pkg,variant,f))),h);
const printer=ts.createPrinter({removeComments:true});
for(const file of ['services/binance-balance-sync.service.js','services/position-close.service.js']){
 const prints=[];for(const variant of ['baseline','release']){const sf=ts.createSourceFile(file,fs.readFileSync(path.join(pkg,variant,file),'utf8'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
 const transformed=ts.transform(sf,[ctx=>root=>{function visit(n){
 if(ts.isVariableStatement(n)&&n.declarationList.declarations.length===1&&n.declarationList.declarations[0].name.getText(sf)==='wallet_sync_update_1')return undefined;
 if(file.includes('balance-sync')&&ts.isFunctionDeclaration(n)&&n.name?.text==='syncTestnetAccountFromBinance')return ts.factory.updateFunctionDeclaration(n,n.modifiers,n.asteriskToken,n.name,n.typeParameters,[n.parameters[0]],n.type,ts.factory.createBlock([]));
 if(file.includes('position-close')&&ts.isCallExpression(n)&&n.expression.getText(sf).includes('binance_balance_sync_service_1.syncTestnetAccountFromBinance'))return ts.factory.updateCallExpression(n,n.expression,n.typeArguments,[n.arguments[0]]);
 return ts.visitEachChild(n,visit,ctx);
 }return ts.visitNode(root,visit);}]);prints.push(printer.printFile(transformed.transformed[0]));transformed.dispose();
 }if(prints[0]!==prints[1])throw Error('outside wallet sync/observer AST differs '+file);
}
const now=Date.parse('2026-10-02T13:10:00Z');
async function run(variant,scenario){let queries=0,writes=[],events=[];const file=path.join(pkg,variant,'services/binance-balance-sync.service.js'),exports={};
 const fixedDate=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 const mocks={'../lib/prisma':{prisma:{testnetAccount:{update:async value=>{if(scenario.dbFailure)throw Error('db failed');writes.push(value);}}}},'./binance/account':{getAccount:async()=>{queries++;if(scenario.queryError){const e=Error('query failed');e.binanceCode=scenario.queryError;throw e;}return {assets:scenario.fallback?[]:[{asset:'USDT',walletBalance:scenario.wallet??30}],totalWalletBalance:31,totalUnrealizedProfit:1,totalMarginBalance:32};}},'./binance-account-health.service':{isBinanceDemoMetadataUnavailableError:e=>e.binanceCode===-1109}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{exports,require:id=>{if(Object.hasOwn(mocks,id))return mocks[id];if(id.startsWith('../utils/'))return require(path.resolve(path.dirname(file),id+'.js'));throw Error(id);},Date:fixedDate,process:{env:{}},console:{log(){},warn(){}}},{filename:file});
 let result,error;try{result=await exports.syncTestnetAccountFromBinance(1,scenario.noObserver?undefined:e=>{events.push(JSON.parse(JSON.stringify(e)));if(scenario.observerThrows)throw Error('observer');});}catch(e){error=e.message;}
 return {result:result===undefined?undefined:JSON.parse(JSON.stringify(result)),error,queries,writes:JSON.parse(JSON.stringify(writes)),events};
}
(async()=>{let replayed=0;const scenarios=[{}, {wallet:0},{fallback:true},{queryError:-1109},{queryError:-1},{dbFailure:true},{observerThrows:true},{noObserver:true}];
 const replay=require(path.join(pkg,'release/utils/recorded-wallet-sync.js')).replayRecordedWalletSync;
 for(const scenario of scenarios){const b=await run('baseline',scenario),r=await run('release',scenario);assert.equal(r.error,b.error);assert.equal(r.queries,b.queries);assert.deepEqual(r.result,b.result);assert.deepEqual(r.writes,b.writes);
 if(scenario.dbFailure||scenario.noObserver)assert.equal(r.events.length,0);else assert.equal(r.events.length,1);
 for(const e of r.events){const result=replay(e,now,now);assert.equal(result.status,e.status==='applied'?'evaluated':'unknown');if(result.status==='evaluated'){assert.equal(result.matches_recorded,true);replayed++;}}
 }
 const report={allPackageHashesVerified:true,modulesOutsideSyncAndCallbackMatch:true,compiledSyncScenarios:scenarios.length,queryResultAndWriteParity:true,compiledWalletPayloadReplays:replayed,noAppliedEventOnFailedDb:true,observerExceptionNonblocking:true,liveQueries:0,limits:'Mocked wallet component only, not raw asset or full close-service/portfolio proof.'};fs.writeFileSync(path.join(pkg,'compiled-tests.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});

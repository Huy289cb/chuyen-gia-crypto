const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),ts=require('typescript'),vm=require('node:vm');
const pkg=path.resolve(process.argv[2]),m=JSON.parse(fs.readFileSync(path.join(pkg,'manifest.json'))),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.deepEqual(m.changedFiles,['services/binance-fill-pnl.service.js','services/position-close.service.js','utils/close-round-match.js','utils/recorded-close-round.js']);
for(const v of ['baseline','release'])for(const[f,h]of Object.entries(m[v]))assert.equal(sha(fs.readFileSync(path.join(pkg,v,f))),h);
const printer=ts.createPrinter({removeComments:true});
for(const file of ['services/position-close.service.js','services/binance-fill-pnl.service.js']){
 const prints=[];for(const variant of ['baseline','release']){
 const sf=ts.createSourceFile(file,fs.readFileSync(path.join(pkg,variant,file),'utf8'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
 const transform=ts.transform(sf,[ctx=>root=>{function visit(n){
  if(file.includes('position-close')&&ts.isPropertyAssignment(n)&&n.name.getText(sf)==='onEvidence')return undefined;
  if(file.includes('fill-pnl')){
   if(ts.isVariableStatement(n)&&n.declarationList.declarations.length===1&&['side','matches','round','queriedFills','queriedIncome','close_round_match_1'].includes(n.declarationList.declarations[0].name.getText(sf)))return undefined;
   if(ts.isIfStatement(n)&&['matches.length !== 1','!round','params.onEvidence'].includes(n.expression.getText(sf)))return undefined;
   if(ts.isIfStatement(n)&&n.expression.getText(sf).startsWith('Math.abs(round.quantity'))return undefined;
   if(ts.isExpressionStatement(n)&&ts.isBinaryExpression(n.expression)&&['queriedFills','queriedIncome'].includes(n.expression.left.getText(sf)))return undefined;
  }return ts.visitEachChild(n,visit,ctx);
 }return ts.visitNode(root,visit);}]);prints.push(printer.printFile(transform.transformed[0]));transform.dispose();
 }if(prints[0]!==prints[1])throw Error('module outside selected round/journal differs: '+file);
}
const now=Date.parse('2026-10-02T12:45:00Z'),fills=[{tradeId:1,orderId:'entry',side:'BUY',price:100,qty:1,commission:.1,commissionAsset:'USDT',realizedPnl:0,time:now-2000},{tradeId:2,orderId:'exit',side:'SELL',price:110,qty:1,commission:.2,commissionAsset:'USDT',realizedPnl:10,time:now-1000}];
async function run(variant,scenario){let calls=[],evidence;const file=path.join(pkg,variant,'services/binance-fill-pnl.service.js'),exports={};
 const requireMock=id=>{if(id==='./binance-trade-history.service')return {fetchUserTradesByTimeWindows:async(...args)=>{calls.push(['fills',...args]);if(scenario.failure)throw Error('query failed');return fills;}};if(id==='./binance-income.service')return {fetchBinanceIncomeRows:async(...args)=>{calls.push(['income',...args]);return [];}};if(id.startsWith('../utils/'))return require(path.resolve(path.dirname(file),id+'.js'));throw Error(id);};
 const fixedDate=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{exports,require:requireMock,process:{env:{BINANCE_ENABLED:'true'}},Date:fixedDate,console:{warn(){}}},{filename:file});
 const rounds=require(path.join(pkg,variant,'utils/exchange-rounds.js')).reconstructExchangeRounds(fills,[]);
 const result=await exports.resolveClosePnlFromUserTrades({symbol:'BTC',side:'long',entryTime:new Date(now-2000),entryOrderId:scenario.wrong?'missing':'entry',sizeQty:scenario.qty??1,entryPrice:100,fallbackClosePrice:110,...(scenario.supplied?{rounds}:{}),onEvidence:value=>{if(scenario.observerFails)throw Error('observer');evidence=JSON.parse(JSON.stringify(value));}});
 return {calls:JSON.parse(JSON.stringify(calls)),result:JSON.parse(JSON.stringify(result)),evidence};
}
(async()=>{let checked=0;const replay=require(path.join(pkg,'release/utils/recorded-close-round.js')).replayRecordedCloseRound;
 const scenarios=[{}, {wrong:true},{qty:2},{supplied:true},{failure:true},{observerFails:true}];
 for(const scenario of scenarios){const b=await run('baseline',scenario),r=await run('release',scenario);assert.deepEqual(r.calls,b.calls);assert.deepEqual(r.result,b.result);
  if(r.evidence){const result=replay(r.evidence,now,now);assert.equal(result.status,scenario.supplied||scenario.wrong||scenario.qty===2?'unknown':'evaluated');if(result.status==='evaluated')assert.equal(result.exchange_net_pnl,r.result.realizedPnl);checked++;}
 }
 const report={allPackageHashesVerified:true,modulesOutsideSelectionAndJournalMatch:true,compiledResolverScenarios:scenarios.length,queryAndResultParity:true,jsonEvidenceChecks:checked,liveQueries:0,limits:'Mocked component only; not real round events or full portfolio parity.'};fs.writeFileSync(path.join(pkg,'compiled-tests.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});

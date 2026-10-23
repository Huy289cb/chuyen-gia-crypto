const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),ts=require('typescript'),Module=require('node:module');
const pkg=path.resolve(process.argv[2]),manifest=JSON.parse(fs.readFileSync(path.join(pkg,'manifest.json')));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.deepEqual(manifest.changedFiles,['services/binance/trading.js','services/protective-order.service.js','utils/algo-contract-evidence.js']);
for(const variant of ['baseline','release'])for(const[f,h]of Object.entries(manifest[variant]))assert.equal(sha(fs.readFileSync(path.join(pkg,variant,f))),h);
const printer=ts.createPrinter({removeComments:true}),stripped={properties:0,requires:0};
for(const file of ['services/binance/trading.js','services/protective-order.service.js']){
 const parse=variant=>ts.createSourceFile(file,fs.readFileSync(path.join(pkg,variant,file),'utf8'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
 const base=parse('baseline'),release=parse('release');
 const transform=ts.transform(release,[ctx=>root=>{
  function visit(node){
   if(ts.isVariableStatement(node)&&node.declarationList.declarations.length===1&&node.declarationList.declarations[0].name.getText(release)==='algo_contract_evidence_1'){stripped.requires++;return undefined;}
   if(ts.isPropertyAssignment(node)&&node.name.getText(release)==='algo_contract_evidence'){stripped.properties++;return undefined;}
   return ts.visitEachChild(node,visit,ctx);
  }return ts.visitNode(root,visit);
 }]);
 assert.equal(printer.printFile(transform.transformed[0]),printer.printFile(base),file);transform.dispose();
}
assert.deepEqual(stripped,{properties:3,requires:1});
async function run(variant,fn,response){
 const calls=[],file=path.join(pkg,variant,'services/binance/trading.js'),m=new Module(file,module);m.filename=file;
 m.require=id=>{if(id==='./client')return {post:async(...args)=>{calls.push(args);return response;}};if(id==='./endpoints')return {endpoints:{ALGO_ORDER:'/fapi/v1/algoOrder'}};if(id==='../../utils/algo-contract-evidence')return require(path.join(pkg,'release/utils/algo-contract-evidence.js'));throw Error('unmocked '+id);};
 m._compile(fs.readFileSync(file,'utf8'),file);
 return {calls,result:await m.exports[fn]({symbol:'BTCUSDT',side:'SELL',quantity:'0.001',stopPrice:'90',reduceOnly:true})};
}
(async()=>{
 let scenarios=0;
 for(const fn of ['placeStopMarketOrder','placeTakeProfitMarketOrder'])for(const response of [
  {algoId:123,symbol:'BTCUSDT',side:'SELL',quantity:'0.001',triggerPrice:'90',algoStatus:'NEW',workingType:'CONTRACT_PRICE',reduceOnly:true},
  {orderId:456,origQty:'0.001',stopPrice:'90',status:'NEW'}, {},
 ]){
  const b=await run('baseline',fn,response),r=await run('release',fn,response);assert.deepEqual(r.calls,b.calls);
  const {algo_contract_evidence:evidence,...legacy}=r.result;assert.deepEqual(legacy,b.result);assert.equal(evidence.schema,'algo-contract-evidence-v1');
  assert.equal(evidence.request.triggerPrice,'90');assert.equal(evidence.response.triggerPrice,response.triggerPrice??null);
  assert.equal(evidence.response.workingType,response.workingType??null);scenarios++;
 }
 const report={allPackageHashesVerified:true,wholeModuleAstMatchesAfterRemovingEvidence:true,removedEvidenceNodes:stripped,compiledScenarios:scenarios,wireRequestsAndLegacyOutputsMatch:true,liveOrdersSent:0,limits:'Raw evidence only; not full ACK validation, portfolio parity or runtime deployment.'};
 fs.writeFileSync(path.join(pkg,'compiled-tests.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
})().catch(error=>{console.error(error);process.exitCode=1;});

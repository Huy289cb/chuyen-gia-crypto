// Isolated overlay: exact deployed JS plus recording, without unrelated source changes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const [baseline,out]=process.argv.slice(2);if(!baseline||!out||fs.existsSync(out))throw Error('Usage: BASELINE NEW_PACKAGE');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const inventory=root=>Object.fromEntries(fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{
 const p=path.join(e.parentPath||e.path,e.name);return[path.relative(root,p),sha(fs.readFileSync(p))];
}).sort(([a],[b])=>a.localeCompare(b)));
const before=inventory(baseline);
fs.mkdirSync(out,{recursive:true});fs.cpSync(baseline,path.join(out,'baseline'),{recursive:true});fs.cpSync(baseline,path.join(out,'release'),{recursive:true});
const sourceHashes={};
for(const rel of ['utils/algo-contract-evidence','services/protective-order.service']){
 const source=fs.readFileSync(path.join(__dirname,'../src/'+rel+'.ts'),'utf8');sourceHashes[rel]=sha(source);
 fs.writeFileSync(path.join(out,'release',rel+'.js'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText);
}
// Patch only the two normalized return objects in deployed trading JS.
const tradingPath=path.join(out,'release/services/binance/trading.js');
let trading=fs.readFileSync(tradingPath,'utf8');
const ast=ts.createSourceFile('trading.js',trading,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS),insertions=[];
for(const name of ['placeStopMarketOrder','placeTakeProfitMarketOrder']){
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);if(!fn)throw Error('missing '+name);
 const returns=[];function visit(n){if(ts.isReturnStatement(n)&&n.expression&&ts.isObjectLiteralExpression(n.expression)&&n.expression.properties.some(p=>p.name?.getText(ast)==='orderId'))returns.push(n.expression);ts.forEachChild(n,visit);}visit(fn);
 if(returns.length!==1)throw Error('ambiguous normalized return '+name);
 insertions.push(returns[0].getStart(ast)+1);
}
for(const index of insertions.sort((a,b)=>b-a))trading=trading.slice(0,index)+'\n            algo_contract_evidence: (0, algo_contract_evidence_1.captureAlgoContractEvidence)(requestParams, response),'+trading.slice(index);
trading='const algo_contract_evidence_1 = require("../../utils/algo-contract-evidence");\n'+trading;
fs.writeFileSync(tradingPath,trading);
sourceHashes['services/binance/trading']=sha(fs.readFileSync(path.join(__dirname,'../src/services/binance/trading.ts')));
const after=inventory(path.join(out,'release'));
if(JSON.stringify(before)!==JSON.stringify(inventory(baseline)))throw Error('baseline_changed');
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({baseline:before,release:after,changedFiles:Object.keys(after).filter(k=>before[k]!==after[k]),runtimeDeployed:false,environmentChanges:false,sourceHashes},null,2));
console.log(JSON.stringify({out,changedFiles:Object.keys(after).filter(k=>before[k]!==after[k])}));

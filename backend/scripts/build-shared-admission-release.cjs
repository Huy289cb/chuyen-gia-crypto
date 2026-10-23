// Isolated overlay: exact deployed JS plus recording, without unrelated source changes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const [baseline,out]=process.argv.slice(2);if(!baseline||!out||fs.existsSync(out))throw Error('Usage: BASELINE NEW_PACKAGE');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const inventory=root=>Object.fromEntries(fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{
 const p=path.join(e.parentPath||e.path,e.name);return[path.relative(root,p),sha(fs.readFileSync(p))];
}).sort(([a],[b])=>a.localeCompare(b)));
const before=inventory(baseline);
fs.mkdirSync(out,{recursive:true});fs.cpSync(baseline,path.join(out,'baseline'),{recursive:true});fs.cpSync(baseline,path.join(out,'release'),{recursive:true});
const sources={};
for(const name of ['post-quantity-admission','recorded-post-quantity']){
 const source=fs.readFileSync(path.join(__dirname,'../src/utils/'+name+'.ts'),'utf8');sources[name]=sha(source);
 fs.writeFileSync(path.join(out,'release/utils/'+name+'.js'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
}
const file=path.join(out,'release/services/v3-trade-execution.service.js');let code=fs.readFileSync(file,'utf8');
const anchor='if (effectiveRiskUsd > effectiveRiskCapUsd + 1e-9)';
if(code.split(anchor).length!==2)throw Error('ambiguous_risk_anchor');
const start=code.indexOf(anchor),end=code.indexOf('const orderId =',start);if(end<0)throw Error('missing_order_anchor');
code=code.slice(0,start)+`
const expectedRr = (0, trade_levels_1.computeExpectedRrFromPrices)(entry, stopLoss, takeProfit) ?? Number(analysis.expected_rr) ?? 0;
const minRr = requiredMinRr ?? auto.minRRRatio;
const admissionInput = {side,entry,stopLoss,effectiveRiskUsd,effectiveRiskPercent,effectiveRiskCapUsd,expectedRr,minRr,
 invalidation:Number(analysis.invalidation_level),dailyEnabled:riskPolicy.circuitDailyLossEnabled,remainingDailyRiskUsd:accountGuard.remainingDailyRiskUsd};
const admission = require('../utils/post-quantity-admission').evaluatePostQuantityAdmission(admissionInput);
await entry_trace_1.recordEntryStage('post_quantity_evaluated',{input:require('../utils/recorded-post-quantity').encodePostQuantityInput(admissionInput),decision:admission});
if (!admission.allowed) return {success:false,reason:admission.reason,...(admission.rejectionCode?{rejectionCode:admission.rejectionCode}:{})};
`+code.slice(end);
fs.writeFileSync(file,code);
const after=inventory(path.join(out,'release'));
if(JSON.stringify(before)!==JSON.stringify(inventory(baseline)))throw Error('baseline_changed');
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({baseline:before,release:after,changedFiles:Object.keys(after).filter(k=>before[k]!==after[k]),runtimeDeployed:false,environmentChanges:false,sourceHashes:sources},null,2));
console.log(JSON.stringify({out,changedFiles:Object.keys(after).filter(k=>before[k]!==after[k])}));

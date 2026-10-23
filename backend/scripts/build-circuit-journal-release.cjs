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
const service='services/account-circuit.service.js';
const source=fs.readFileSync(path.join(__dirname,'../src/services/account-circuit.service.ts'),'utf8');sourceHashes.service=sha(source);
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
let deployed=fs.readFileSync(path.join(out,'baseline',service),'utf8');
const original=deployed,patches=[];
function range(text,start,end){const a=text.indexOf(start),b=text.indexOf(end,a);if(a<0||b<=a)throw Error('missing_region '+start);return {a,b,text:text.slice(a,b)};}
function replace(oldStart,newStart,end){const old=range(deployed,oldStart,end),next=range(compiled,newStart,end);patches.push({old:old.text,next:next.text});deployed=deployed.slice(0,old.a)+next.text+deployed.slice(old.b);}
replace('    if (drawdownPercent >','    if (drawdownPercent >','    const outcomes =');
function declaration(text,name){const ast=ts.createSourceFile('service.js',text,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);const n=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);if(!n)throw Error('missing_function '+name);return {a:n.getStart(ast),b:n.end,text:n.getText(ast)};}
for(const name of ['applyExpectancyKillCooldownIfNeeded']){const old=declaration(deployed,name),next=declaration(compiled,name);patches.push({old:old.text,next:next.text});deployed=deployed.slice(0,old.a)+next.text+deployed.slice(old.b);}
const math=declaration(deployed,'calcDrawdownPercent');
const mathNew="function calcDrawdownPercent(peakEquity, currentEquity) { return require('../utils/account-drawdown-percent').calcDrawdownPercent(peakEquity, currentEquity); }";
patches.push({old:math.text,next:mathNew});deployed=deployed.slice(0,math.a)+mathNew+deployed.slice(math.b);
const publisher="const node_crypto_1 = require('node:crypto');\nfunction publishCircuitMutation(evidence, appliedAt) { void Promise.resolve().then(() => require('../utils/account-wallet-journal')).then(module => module.persistAccountWalletObservation({...evidence,applied_at:appliedAt,applied_clock_source:'db_update_return'},'account_circuit_mutation_applied')).catch(() => console.warn('[AccountCircuit] Mutation journal unavailable')); }\n";
deployed=deployed.replace('async function getAccountCircuitStatus',publisher+'async function getAccountCircuitStatus');
let restored=deployed.replace(publisher,'');for(const patch of [...patches].reverse()){if(restored.split(patch.next).length!==2)throw Error('ambiguous_restoration');restored=restored.replace(patch.next,patch.old);}if(restored!==original)throw Error('outside_regions_changed');
if(deployed.includes('__importStar'))throw Error('unexpected_import_helper');
fs.writeFileSync(path.join(out,'release',service),deployed);
for(const rel of ['utils/account-drawdown-percent','utils/recorded-account-circuit-mutation']){const source=fs.readFileSync(path.join(__dirname,'../src/'+rel+'.ts'),'utf8');sourceHashes[rel]=sha(source);fs.writeFileSync(path.join(out,'release',rel+'.js'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText);}
fs.writeFileSync(path.join(out,'boundary-proof.json'),JSON.stringify({outsideRegionsByteParity:true,regions:['max_drawdown write block','expectancy cooldown function','drawdown helper forwarding','new publisher and crypto dependency'],runtimeDeployed:false},null,2));
const after=inventory(path.join(out,'release'));
if(JSON.stringify(before)!==JSON.stringify(inventory(baseline)))throw Error('baseline_changed');
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({baseline:before,release:after,changedFiles:Object.keys(after).filter(k=>before[k]!==after[k]),runtimeDeployed:false,environmentChanges:false,sourceHashes},null,2));
console.log(JSON.stringify({out,changedFiles:Object.keys(after).filter(k=>before[k]!==after[k])}));

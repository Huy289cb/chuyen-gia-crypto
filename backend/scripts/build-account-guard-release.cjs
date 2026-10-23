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
for(const rel of ['utils/account-initial-guard','utils/recorded-account-guard-mutation']){
 const source=fs.readFileSync(path.join(__dirname,'../src/'+rel+'.ts'),'utf8');sourceHashes[rel]=sha(source);
 fs.writeFileSync(path.join(out,'release',rel+'.js'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText);
}
const rel='services/account-risk-guard.service';
const source=fs.readFileSync(path.join(__dirname,'../src/'+rel+'.ts'),'utf8');sourceHashes[rel]=sha(source);
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
let deployed=fs.readFileSync(path.join(out,'baseline',rel+'.js'),'utf8');
function section(text,start,end){const a=text.indexOf(start),b=text.indexOf(end,a);if(a<0||b<a)throw Error('missing_patch_boundary '+start);return {a,b,text:text.slice(a,b)};}
const oldInitial=section(deployed,' if (protectiveBlock) {',"    if (process.env.BINANCE_ENABLED === 'true' && symbol)");
const newInitial=section(compiled,'    const initialGuard =',"    if (process.env.BINANCE_ENABLED === 'true' && symbol)");
deployed=deployed.slice(0,oldInitial.a)+newInitial.text+deployed.slice(oldInitial.b);
const oldLoss=section(deployed,'                await prisma_1.prisma.testnetAccount.update({','            }\n            return streak;');
const newLoss=section(compiled,'                const evidence =','            }\n            return streak;');
deployed=deployed.slice(0,oldLoss.a)+newLoss.text+deployed.slice(oldLoss.b);
const publisher=`const node_crypto_1 = require('node:crypto');
const account_initial_guard_1 = require('../utils/account-initial-guard');
function publishGuardMutation(evidence, appliedAt) {
 void Promise.resolve().then(() => require('../utils/account-wallet-journal'))
 .then(module => module.persistAccountWalletObservation({...evidence,applied_at:appliedAt,applied_clock_source:'db_update_return'},'account_guard_mutation_applied'))
 .catch(() => console.warn('[AccountRiskGuard] Applied mutation journal unavailable'));
}
`;
deployed=deployed.replace('async function resolveLossStreak',publisher+'async function resolveLossStreak');
fs.writeFileSync(path.join(out,'release',rel+'.js'),deployed);
const after=inventory(path.join(out,'release'));
if(JSON.stringify(before)!==JSON.stringify(inventory(baseline)))throw Error('baseline_changed');
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({baseline:before,release:after,changedFiles:Object.keys(after).filter(k=>before[k]!==after[k]),runtimeDeployed:false,environmentChanges:false,sourceHashes},null,2));
console.log(JSON.stringify({out,changedFiles:Object.keys(after).filter(k=>before[k]!==after[k])}));

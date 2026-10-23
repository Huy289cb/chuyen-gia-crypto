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
for(const rel of ['utils/manual-close-account-update','utils/recorded-manual-close']){
 const source=fs.readFileSync(path.join(__dirname,'../src/'+rel+'.ts'),'utf8');sourceHashes[rel]=sha(source);
 fs.writeFileSync(path.join(out,'release',rel+'.js'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText);
}
const rel='routes/testnet.js',source=fs.readFileSync(path.join(__dirname,'../src/routes/testnet.ts'),'utf8');sourceHashes.route=sha(source);
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const original=fs.readFileSync(path.join(baseline,rel),'utf8');
function region(text,fresh=false){
 const route=text.indexOf("router.post('/positions/:id/close'");if(route<0)throw Error('manual_route_missing');
 const a=text.indexOf(fresh?'        const lastTradeTime =':'        await prismaClient.testnetAccount.update({',route);
 const b=text.indexOf('        await prismaClient.testnetTradeEvent.create({',a);
 if(a<route||b<=a)throw Error('manual_region_missing');return {a,b,text:text.slice(a,b)};
}
const old=region(original),fresh=region(compiled,true);
const patch=fresh.text.replace('(0, node_crypto_1.randomUUID)()',"require('node:crypto').randomUUID()").replace('(0, manual_close_account_update_1.buildManualCloseAccountUpdate)',"require('../utils/manual-close-account-update').buildManualCloseAccountUpdate");
if(patch.includes('node_crypto_1')||patch.includes('manual_close_account_update_1'))throw Error('unresolved_manual_dependency');
const next=original.slice(0,old.a)+patch+original.slice(old.b);if(next.slice(0,old.a)+old.text+next.slice(old.a+patch.length)!==original)throw Error('outside_manual_changed');
fs.writeFileSync(path.join(out,'release',rel),next);fs.writeFileSync(path.join(out,'boundary-proof.json'),JSON.stringify({outsideManualAccountRegionByteParity:true,runtimeDeployed:false},null,2));
const after=inventory(path.join(out,'release'));
if(JSON.stringify(before)!==JSON.stringify(inventory(baseline)))throw Error('baseline_changed');
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({baseline:before,release:after,changedFiles:Object.keys(after).filter(k=>before[k]!==after[k]),runtimeDeployed:false,environmentChanges:false,sourceHashes},null,2));
console.log(JSON.stringify({out,changedFiles:Object.keys(after).filter(k=>before[k]!==after[k])}));

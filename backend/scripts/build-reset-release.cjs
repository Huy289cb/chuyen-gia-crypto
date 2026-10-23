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
for(const rel of ['utils/account-reset-update','utils/account-reset-receipt','utils/recorded-account-reset','repositories/account-mutation-journal.repository']){
 const source=fs.readFileSync(path.join(__dirname,'../src/'+rel+'.ts'),'utf8');sourceHashes[rel]=sha(source);
 fs.writeFileSync(path.join(out,'release',rel+'.js'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText);
}
const rel='routes/testnet.js',source=fs.readFileSync(path.join(__dirname,'../src/routes/testnet.ts'),'utf8');sourceHashes.route=sha(source);
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const original=fs.readFileSync(path.join(baseline,rel),'utf8');
function region(text,fresh=false){
 const route=text.indexOf("router.post('/reset/:accountId'");if(route<0)throw Error('reset_route_missing');
 const a=text.indexOf(fresh?'        const updatedAt =':'        await prismaClient.$transaction([',route);
 const b=text.indexOf('        return res.json({',a);
 if(a<route||b<=a)throw Error('reset_region_missing');return {a,b,text:text.slice(a,b)};
}
const old=region(original),fresh=region(compiled,true);
let patch=fresh.text.replace('(0, node_crypto_1.randomUUID)()',"require('node:crypto').randomUUID()");
for(const [identifier,rel,name] of [['account_reset_update_1','utils/account-reset-update','buildAccountResetUpdate'],['account_reset_receipt_1','utils/account-reset-receipt','buildAccountResetReceipt'],['account_mutation_journal_repository_1','repositories/account-mutation-journal.repository','insertAccountResetReceipt']]){
 patch=patch.replaceAll('(0, '+identifier+'.'+name+')',"require('../"+rel+"')."+name);
 if(patch.includes(identifier))throw Error('unresolved_reset_dependency');
}
if(patch.includes('node_crypto_1'))throw Error('unresolved_crypto');
const next=original.slice(0,old.a)+patch+original.slice(old.b);if(next.slice(0,old.a)+old.text+next.slice(old.a+patch.length)!==original)throw Error('outside_reset_changed');
fs.writeFileSync(path.join(out,'release',rel),next);fs.writeFileSync(path.join(out,'boundary-proof.json'),JSON.stringify({outsideResetTransactionByteParity:true,runtimeDeployed:false},null,2));
const sql=fs.readFileSync(path.join(__dirname,'../sql/account-mutation-journal-v1.sql'));fs.writeFileSync(path.join(out,'account-mutation-journal-v1.sql'),sql);sourceHashes.schemaSql=sha(sql);
const after=inventory(path.join(out,'release'));
if(JSON.stringify(before)!==JSON.stringify(inventory(baseline)))throw Error('baseline_changed');
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({baseline:before,release:after,changedFiles:Object.keys(after).filter(k=>before[k]!==after[k]),runtimeDeployed:false,environmentChanges:false,sourceHashes},null,2));
console.log(JSON.stringify({out,changedFiles:Object.keys(after).filter(k=>before[k]!==after[k])}));

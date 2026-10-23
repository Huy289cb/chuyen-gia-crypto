const fs=require('fs'),path=require('path'),crypto=require('crypto'),ts=require('typescript'),assert=require('assert/strict');
const [baseline,out]=process.argv.slice(2);if(!baseline||!out||fs.existsSync(out))throw Error('BASELINE NEW_PACKAGE');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const inventory=root=>Object.fromEntries(fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{const p=path.join(e.parentPath||e.path,e.name);return[path.relative(root,p),hash(fs.readFileSync(p))];}).sort(([a],[b])=>a.localeCompare(b)));
const before=inventory(baseline);fs.mkdirSync(out,{recursive:true});fs.cpSync(baseline,path.join(out,'baseline'),{recursive:true});fs.cpSync(baseline,path.join(out,'release'),{recursive:true});
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const source=fs.readFileSync(path.join(__dirname,'../src/repositories/testnet.repository.ts'),'utf8'),compiled=compile(source);
const rel='repositories/testnet.repository.js',old=fs.readFileSync(path.join(baseline,rel),'utf8');
function fn(text){const ast=ts.createSourceFile('repo.js',text,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS),node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='setTestnetAccountCooldown');assert.ok(node);return {start:node.getStart(ast),end:node.end,text:node.getText(ast)};}
const a=fn(old),b=fn(compiled);
let replacement=b.text.replace('(0, node_crypto_1.randomUUID)()',"require('node:crypto').randomUUID()").replace("__importStar(require('../utils/account-wallet-journal'))","require('../utils/account-wallet-journal')");
assert.ok(!replacement.includes('__importStar')&&!replacement.includes('node_crypto_1'));
const next=old.slice(0,a.start)+replacement+old.slice(a.end);fs.writeFileSync(path.join(out,'release',rel),next);
const adapter='utils/recorded-account-cooldown-set';const adapterSource=fs.readFileSync(path.join(__dirname,'../src/'+adapter+'.ts'),'utf8');fs.writeFileSync(path.join(out,'release',adapter+'.js'),compile(adapterSource));
const restored=next.slice(0,a.start)+a.text+next.slice(a.start+replacement.length);assert.equal(restored,old,'outside setter byte parity');
const after=inventory(path.join(out,'release'));assert.deepEqual(before,inventory(baseline));
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({baseline:before,release:after,changedFiles:Object.keys(after).filter(k=>before[k]!==after[k]),sourceHashes:{repository:hash(source),adapter:hash(adapterSource)},outsideSetterByteParity:true,runtimeDeployed:false,environmentChanges:false},null,2));console.log('Cooldown setter package built; outside setter byte parity passed');

const fs=require('fs'),path=require('path'),crypto=require('crypto'),ts=require('typescript'),assert=require('assert/strict');
const [baseline,out]=process.argv.slice(2);if(!baseline||!out||fs.existsSync(out))throw Error('BASELINE NEW_PACKAGE');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const inventory=root=>Object.fromEntries(fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{const p=path.join(e.parentPath||e.path,e.name);return[path.relative(root,p),hash(fs.readFileSync(p))];}).sort(([a],[b])=>a.localeCompare(b)));
const before=inventory(baseline);fs.mkdirSync(out,{recursive:true});fs.cpSync(baseline,path.join(out,'baseline'),{recursive:true});fs.cpSync(baseline,path.join(out,'release'),{recursive:true});
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const source=fs.readFileSync(path.join(__dirname,'../src/services/position-pnl-backfill.service.ts'),'utf8'),compiled=compile(source);
const rel='services/position-pnl-backfill.service.js',old=fs.readFileSync(path.join(baseline,rel),'utf8');
function fn(text){const ast=ts.createSourceFile('repo.js',text,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS),node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='recomputeTestnetAccountTradeStats');assert.ok(node);return {start:node.getStart(ast),end:node.end,text:node.getText(ast)};}
const a=fn(old),b=fn(compiled);
let replacement=b.text.replaceAll('(0, node_crypto_1.randomUUID)()',"require('node:crypto').randomUUID()").replace('(0, backfill_account_statistics_1.buildBackfillAccountStatistics)(closed)',"require('../utils/backfill-account-statistics').buildBackfillAccountStatistics(closed)").replace('closed.map(backfill_row_evidence_1.encodeBackfillRow)',"closed.map(require('../utils/backfill-row-evidence').encodeBackfillRow)");
assert.ok(!replacement.includes('node_crypto_1')&&!replacement.includes('backfill_account_statistics_1')&&!replacement.includes('backfill_row_evidence_1'));
const publisher="function publishBackfillAccountWrite(evidence, appliedAt) { void Promise.resolve().then(() => require('../utils/account-wallet-journal')).then(module => module.persistAccountWalletObservation({...evidence,applied_at:appliedAt,applied_clock_source:'db_update_return'},'account_backfill_statistics_applied')).catch(() => console.warn('[PnlBackfill] Account write journal unavailable')); }\n";
const next=old.slice(0,a.start)+publisher+replacement+old.slice(a.end);fs.writeFileSync(path.join(out,'release',rel),next);
const sourceHashes={service:hash(source)};
for(const helper of ['backfill-account-statistics','backfill-row-evidence','recorded-backfill-statistics']){const src=fs.readFileSync(path.join(__dirname,'../src/utils/'+helper+'.ts'),'utf8');sourceHashes[helper]=hash(src);fs.writeFileSync(path.join(out,'release/utils/'+helper+'.js'),compile(src));}
const restored=next.slice(0,a.start)+a.text+next.slice(a.start+publisher.length+replacement.length);assert.equal(restored,old,'outside backfill byte parity');
const after=inventory(path.join(out,'release'));assert.deepEqual(before,inventory(baseline));
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({baseline:before,release:after,changedFiles:Object.keys(after).filter(k=>before[k]!==after[k]),sourceHashes,outsideBackfillByteParity:true,runtimeDeployed:false,environmentChanges:false},null,2));console.log('Backfill package built; outside backfill byte parity passed');

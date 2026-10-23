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
for(const rel of ['utils/recorded-structure-permission','services/groq-dispatch.service']){
 const source=fs.readFileSync(path.join(__dirname,'../src/'+rel+'.ts'),'utf8');sourceHashes[rel]=sha(source);
 fs.writeFileSync(path.join(out,'release',rel+'.js'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText);
}
const service='services/groq-dispatch.service.js';
let deployed=fs.readFileSync(path.join(out,'baseline',service),'utf8');
const compiled=fs.readFileSync(path.join(out,'release',service),'utf8');
const start=compiled.indexOf('const structureInput ='),end=compiled.indexOf('structureBias = structCheck.bias;',start);
const oldStart=deployed.indexOf('const structCheck ='),oldEnd=deployed.indexOf('structureBias = structCheck.bias;',oldStart);
if([start,end,oldStart,oldEnd].some(i=>i<0))throw Error('missing_structure_patch');
deployed=deployed.slice(0,oldStart)+compiled.slice(start,end)+deployed.slice(oldEnd);
const evidence='measuredSetup.evidence.playbooks.find';
if(!deployed.includes(evidence))throw Error('missing_evidence_patch');
deployed=deployed.replace(evidence,'measuredSetup.evidence?.playbooks?.find');
fs.writeFileSync(path.join(out,'release',service),deployed);
const after=inventory(path.join(out,'release'));
if(JSON.stringify(before)!==JSON.stringify(inventory(baseline)))throw Error('baseline_changed');
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({baseline:before,release:after,changedFiles:Object.keys(after).filter(k=>before[k]!==after[k]),runtimeDeployed:false,environmentChanges:false,sourceHashes},null,2));
console.log(JSON.stringify({out,changedFiles:Object.keys(after).filter(k=>before[k]!==after[k])}));

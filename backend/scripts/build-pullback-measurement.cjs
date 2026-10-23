// Isolated overlay: exact deployed JS plus recording, without unrelated source changes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const [baseline,out]=process.argv.slice(2);if(!baseline||!out||fs.existsSync(out))throw Error('Usage: BASELINE NEW_PACKAGE');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const inventory=root=>Object.fromEntries(fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{
 const p=path.join(e.parentPath||e.path,e.name);return[path.relative(root,p),sha(fs.readFileSync(p))];
}).sort(([a],[b])=>a.localeCompare(b)));
const before=inventory(baseline);
fs.mkdirSync(out,{recursive:true});fs.cpSync(baseline,path.join(out,'baseline'),{recursive:true});fs.cpSync(baseline,path.join(out,'release'),{recursive:true});
const file=path.join(out,'release/services/groq-dispatch.service.js');let s=fs.readFileSync(file,'utf8');
function replace(a,b){if(s.split(a).length!==2)throw Error('ambiguous patch anchor');s=s.replace(a,b);}
replace('const pb = (0, v3_entry_policy_1.evaluateTrendPullbackEntry)({','const evaluation = require("../utils/pullback-evaluation").evaluateRecordedPullback({');
replace('tfLabel: `SMA${period}@${pbTf}`,\n                    });','tfLabel: `SMA${period}@${pbTf}`,\n                        enabled: (0, v3_entry_policy_1.isV3RequirePullback)(),\n                    });\n                    const pb = evaluation.result;\n                    await (0, entry_trace_1.recordEntryStage)("pullback_evaluated", { evaluation, entry_source: "analysis.suggested_entry", observed_at: Date.now() });');
replace('catch (pbErr) {','catch (pbErr) {\n                    await (0, entry_trace_1.recordEntryStage)("pullback_unavailable", { data_status: "unavailable" });');
if(!s.includes('const entry_trace_1 = require('))throw Error('missing trace binding');
fs.writeFileSync(file,s);
const source=fs.readFileSync(path.join(__dirname,'../src/utils/pullback-evaluation.ts'),'utf8');
fs.writeFileSync(path.join(out,'release/utils/pullback-evaluation.js'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
const after=inventory(path.join(out,'release'));
if(JSON.stringify(before)!==JSON.stringify(inventory(baseline)))throw Error('baseline_changed');
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({baseline:before,release:after,changedFiles:Object.keys(after).filter(k=>before[k]!==after[k]),runtimeDeployed:false,environmentChanges:false,sourceSha256:sha(source)},null,2));
console.log(JSON.stringify({out,changedFiles:Object.keys(after).filter(k=>before[k]!==after[k])}));

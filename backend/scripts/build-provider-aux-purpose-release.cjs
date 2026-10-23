const fs=require('fs'),path=require('path'),crypto=require('crypto'),ts=require('typescript'),cp=require('child_process');
const [base,out]=process.argv.slice(2);if(!base||!out||fs.existsSync(out))throw Error('BASE NEW_PACKAGE');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const inventory=root=>Object.fromEntries(fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{const f=path.join(e.parentPath||e.path,e.name);return[path.relative(root,f),sha(fs.readFileSync(f))];}).sort(([a],[b])=>a.localeCompare(b)));
const before=inventory(base),sourceHashes={},boundaries=[];fs.mkdirSync(out,{recursive:true});for(const dir of ['baseline','release'])fs.cpSync(base,path.join(out,dir),{recursive:true});
for(const [rel,purpose,callee,expected,helper]of [['services/ai-opportunity-provider.js','opportunity_review','(0, llm_telemetry_service_1.fetchWithLlmTelemetry)',1,'../utils/provider-purpose-context'],['services/telegram/telegram-ai.service.js','telegram','groq.completeText',2,'../../utils/provider-purpose-context']]){
 const original=fs.readFileSync(path.join(base,rel),'utf8'),ast=ts.createSourceFile(rel,original,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),matches=[];
 function visit(n){if(ts.isAwaitExpression(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(ast)===callee){matches.push(n.expression);}ts.forEachChild(n,visit);}visit(ast);if(matches.length!==expected)throw Error('ambiguous provider call '+rel);
 let next=original;const patches=[];
 for(const n of matches.sort((a,b)=>b.getStart(ast)-a.getStart(ast))){const a=n.getStart(ast),b=n.end,old=original.slice(a,b),patch="require('"+helper+"').withProviderPurpose('"+purpose+"', () => "+old+')';next=next.slice(0,a)+patch+next.slice(b);patches.push({a,old,patch});}
 let reversed=next;for(const {a,old,patch}of [...patches].reverse()){if(reversed.slice(a,a+patch.length)!==patch)throw Error('patch reversal mismatch');reversed=reversed.slice(0,a)+old+reversed.slice(a+patch.length);}if(reversed!==original)throw Error('outside call mismatch');
 const target=path.join(out,'release',rel);fs.writeFileSync(target,next);cp.execFileSync(process.execPath,['--check',target],{stdio:'pipe'});
 const source=fs.readFileSync(path.join(__dirname,'../src',rel.replace(/\.js$/,'.ts')));if(!source.toString().includes("withProviderPurpose('"+purpose+"'"))throw Error('source purpose absent');sourceHashes[rel]=sha(source);boundaries.push({rel,purpose,callee,originalCallSha256:patches.map(p=>sha(p.old)),callCount:expected,outsideCallByteParity:true,syntaxCheck:true});
}
const after=inventory(path.join(out,'release'));if(Object.keys(after).filter(f=>before[f]!==after[f]).length!==2)throw Error('unexpected changed files');
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({baseline:before,release:after,changedFiles:Object.keys(after).filter(f=>before[f]!==after[f]),sourceHashes,boundaries,runtimeDeployed:false,environmentChanges:false},null,2),{flag:'wx',mode:0o600});console.log('Auxiliary purpose package built: 2 files, 3 exact call wrappers');

const fs=require('fs'),path=require('path'),ts=require('typescript'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../docs/audits/2026-09-24-range-implementation/release');
const files=['post-exit-observer','services/post-exit-observer.service','services/memory.service','repositories/memory.repository',
 'utils/post-exit-analysis','utils/post-exit-memory','utils/range-mirror-observation','utils/llm-shadow-outcome','config/pending-order-policy'];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');const manifest=[];
for(const name of files){const source=fs.readFileSync(path.join(root,'src',name+'.ts'));const candidate=ts.transpileModule(source.toString(),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 const live=path.join(root,'dist',name+'.js');for(const folder of ['candidate','source','backup'])fs.mkdirSync(path.dirname(path.join(out,folder,name+'.js')),{recursive:true});
 fs.writeFileSync(path.join(out,'candidate',name+'.js'),candidate);fs.writeFileSync(path.join(out,'source',name+'.ts'),source);
 let before=null;if(fs.existsSync(live)){const b=fs.readFileSync(live);before=sha(b);if(!fs.existsSync(path.join(out,'backup',name+'.js')))fs.writeFileSync(path.join(out,'backup',name+'.js'),b);}
 manifest.push({name,sourceSha:sha(source),beforeSha:before,afterSha:sha(candidate)});
}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({builtAt:new Date().toISOString(),files:manifest},null,2));console.log('Built '+files.length+' selective modules; live files untouched');

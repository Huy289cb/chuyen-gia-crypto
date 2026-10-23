const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createSourceGuard}=require('./testbed-source-guard.cjs');
test('source guard permits unchanged sources, detects edits and new files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'crypto-trial-guard-'));
 try{const file=path.join(root,'a.ts');fs.writeFileSync(file,'original');const guard=createSourceGuard([root]);
  assert.deepEqual(guard.verify(),guard.initial);fs.writeFileSync(file,'modified');assert.throws(()=>guard.verify(),/trial_sources_changed/);
  fs.writeFileSync(file,'original');fs.writeFileSync(path.join(root,'b.ts'),'added');assert.throws(()=>guard.verify(),/trial_sources_changed/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

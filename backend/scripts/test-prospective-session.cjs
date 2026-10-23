const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {startSession}=require('./prospective-session.cjs');
test('records completed window separately from early zero-code exit and nonzero failure',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'crypto-session-test-'));
 try{
  let now=100;const a=startSession(root,{stopAt:200},()=>now);now=150;a(0,false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'session-end-100.json'))).reason,'early_exit');
  now=300;const b=startSession(root,{stopAt:400},()=>now);now=400;b(0,true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'session-end-300.json'))).completedWindow,true);
  now=500;const c=startSession(root,{stopAt:600},()=>now);now=600;c(1,true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'session-end-500.json'))).reason,'nonzero_exit');
  assert.throws(()=>b(0,true),/EEXIST/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

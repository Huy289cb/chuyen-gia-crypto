const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createJournal}=require('./prospective-journal.cjs');
test('durable hour dedupe, ICT quota and immutable records survive a new caller',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'crypto-prospective-test-'));
 try{const j=createJournal(root);assert.ok(j.claimReview(0,2));assert.equal(createJournal(root).claimReview(1000,2),null);
  assert.ok(j.claimReview(3600000,2));assert.equal(j.claimReview(7200000,2),null);
  assert.ok(j.claimReview(17*3600000,2));j.record('snapshot-1',{safe:true});
  assert.throws(()=>j.record('snapshot-1',{safe:false}),/record_already_exists/);
  assert.throws(()=>j.record('../escape',{}),/invalid_journal_key/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

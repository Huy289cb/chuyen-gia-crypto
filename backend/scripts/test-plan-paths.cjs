const assert=require('node:assert/strict'),{describe}=require('./diagnose-plan-paths.cjs');
const plan={time:1,side:'long',entry:100,stop:99,target:102};
assert.equal(describe(plan,[],1).status,'unknown');
const bar={openTime:60000,open:100,high:103,low:98,close:100};
const r=describe(plan,[bar],1);assert.equal(r.firstBarrier,'ambiguous');assert.equal(r.mfeBeforeStopFullMinutesR,0);assert.equal(r.executableFill,'unknown');
assert.equal(describe({...plan,side:'short',stop:101,target:98},[bar],1).firstBarrier,'ambiguous');
assert.equal(describe(plan,[{...bar,low:100}],1).firstBarrier,'target');
console.log('6 path diagnosis assertions passed');

const assert=require('node:assert/strict'),{strongClose}=require('./breakout-improvement-filter.cjs');
const bars=[[0,100,110,90,105,1],[900000,100,110,90,95,1],[1800000,100,110,90,104.9,1]];
const c=(i,side)=>({id:String(i),sourceClose:(i+1)*900000,time:(i+1)*900000+60000,side});
assert.deepEqual(strongClose([c(0,'long'),c(1,'short'),c(2,'long')],bars).map(c=>c.id),['0','1']);
assert.equal(strongClose([{...c(0,'long'),time:900000}],bars).length,0,'same-time close is not available before decision');
assert.deepEqual(strongClose([c(0,'long')],bars.slice(0,1)),strongClose([c(0,'long')],bars),'future bars must not affect filter');
assert.equal(strongClose([c(0,'long')],[[0,100,100,100,100,1]]).length,0);
console.log('PASS: long/short threshold, causal time, prefix independence, flat bar');

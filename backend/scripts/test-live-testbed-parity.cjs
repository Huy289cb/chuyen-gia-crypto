const assert=require('node:assert/strict');const {compare}=require('./check-live-testbed-parity.cjs');
const p={hashes:{'worker.js':'a'},policyEnv:{MODEL:'q',RR:'2'}};
assert(compare(p,structuredClone(p)).matches);
assert(!compare(p,{...p,hashes:{'worker.js':'b'}}).matches);
assert(!compare(p,{...p,hashes:{...p.hashes,'new.js':'n'}}).matches);
assert(!compare(p,{...p,policyEnv:{MODEL:'new',RR:'2'}}).matches);
assert(!compare(p,{...p,policyEnv:{MODEL:'q'}}).matches);
console.log('PASS: exact match, changed/new module, changed/missing policy');

const assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(process.argv[2]);
const baseline=require(path.join(root,'baseline/config/v3-entry-policy.js'));
const release=require(path.join(root,'release/utils/pullback-evaluation.js'));
let cases=0;
for(const side of ['long','short'])for(const enabled of [true,false])for(const count of [0,19,20,25])for(const entry of [98,99.75,100,100.25,102]){
 const input={side,enabled,entry,closes:Array(count).fill(100),smaPeriod:20,maxAbovePct:.25,maxBelowPct:1,tfLabel:'SMA20@15m'};
 assert.deepEqual(release.evaluateRecordedPullback(input).result,baseline.evaluateTrendPullbackEntry(input));cases++;
}
console.log(JSON.stringify({cases,decisionParity:true,scope:'synthetic component parity, not profitability'}));

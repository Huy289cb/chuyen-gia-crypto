const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const root=path.resolve(process.argv[2]),manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
for(const f of manifest.changedFiles)new vm.Script(fs.readFileSync(path.join(root,'release',f),'utf8'),{filename:f});
const strip=result=>{const clone=structuredClone(result);for(const key of ['detectorVersion','anchorHighOpenTime','anchorLowOpenTime','anchorWindowEndOpenTime','detectionOpenTime'])delete clone.evidence.metrics[key];return clone;};
let cases=0;
for(const [file,fn] of [['breakout-volume','analyzeBreakoutVolume'],['liquidity-sweep','analyzeLiquiditySweep']]){
 const old=require(path.join(root,'baseline/analyzers',file+'.analyzer.js'))[fn],current=require(path.join(root,'release/analyzers',file+'.analyzer.js'))[fn];
 for(const count of [0,10,19,20,29,30,60])for(const close of [90,100,110])for(const volume of [0,1,3]){
  const candles=Array.from({length:count},(_,i)=>({timestamp:i*300000,open:100,high:i===count-1?115:102,low:i===count-1?85:98,close:i===count-1?close:100,volume:i===count-1?volume:1}));
  assert.deepStrictEqual(strip(current(candles)),old(candles));cases++;
 }
}
const oldClosed=require(path.join(root,'baseline/utils/closed-candles.js')),currentClosed=require(path.join(root,'release/utils/closed-candles.js'));
for(const tf of ['1m','5m','15m','1h','4h','1d','unknown'])for(const now of [0,60000,65000,300000,305000,86405000]){
 const bars=[{timestamp:0},{timestamp:300000}];assert.deepStrictEqual(currentClosed.closedCandlesOnly(bars,tf,now,5000),oldClosed.closedCandlesOnly(bars,tf,now,5000));cases++;
}
console.log(JSON.stringify({syntaxFiles:manifest.changedFiles.length,cases,componentDecisionParity:true,limits:'Detector/candle component comparison only; service integration and deployment checks still required.'}));

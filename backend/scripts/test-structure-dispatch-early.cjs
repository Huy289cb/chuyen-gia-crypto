const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]);
async function run(tree,signal){
 const file=path.join(root,tree,'services/groq-dispatch.service.js'),events=[];let active;
 const traceApi={createEntryTrace:input=>({...input,trace_id:'test',policy_hash:'test',evaluated_at:'2026-10-02T00:00:00Z'}),currentEntryTrace:()=>active,withEntryTrace:async(trace,fn)=>{active=trace;try{return await fn();}finally{active=undefined;}},recordEntryStage:async(stage,data={})=>events.push({...active,stage,...data})};
 const m=new Module(file,module);m.filename=file;
 m.require=id=>{
 if(id==='../utils/entry-trace')return traceApi;
 if(id==='../utils/candle-hash')return {generateCandleBarKey:()=> 'bar',generateCandleHash:()=> 'bar'};
 if(id==='../config/risk-policy')return {getRiskPolicy:()=>({})};
 if(id==='../config/methods')return {getMethodConfig:()=>({autoEntry:{}})};
 if(id==='../utils/adaptive-retest-dispatch')return {isOptimizedRangeRetest:()=>false};
 if(id==='../utils/setup-trade-side')return {inferSetupTradeSide:()=> 'long'};
 if(id==='../utils/setup-identity')return require(path.join(root,tree,'utils/setup-identity.js'));
 if(id==='../utils/closed-candles')return require(path.join(root,tree,'utils/closed-candles.js'));
 // Other modules are outside these early-return branches. Any unexpected use fails.
 return new Proxy({}, {get:()=>{throw Error('unexpected_dependency_use:'+id);}});
 };
 m._compile(fs.readFileSync(file,'utf8'),file);
 const result=await new m.exports.GroqDispatchService({enableMemory:false}).dispatch({symbol:'BTC',timeframe:'5m',candles:[{timestamp:1200000}],signalResult:signal});
 return {result,events};
}
(async()=>{let cases=0;for(const duplicate of [true,false])for(const known of [true,false]){
 const signal={isDuplicate:duplicate,shouldCallGroq:false,reason:'fixture',setupResult:{playbookKey:'breakout_volume',evidence:{playbooks:[{playbook:'breakout_volume',detected:true,metrics:known?{detectorVersion:'breakout_volume_v1',anchorHighOpenTime:0,anchorLowOpenTime:300000,anchorWindowEndOpenTime:900000,detectionOpenTime:1200000}:{}}]}}};
 const a=await run('baseline',signal),b=await run('release',signal);
 assert.equal(b.result.decision,a.result.decision);assert.equal(b.result.reason,a.result.reason);
 assert.equal(b.result.trace.setup_identity.status,known?'known':'unknown');
 assert.equal(b.events.find(e=>e.stage==='setup_identified').setup_identity.status,known?'known':'unknown');
 assert.equal(b.events.at(-1).setup_identity.status,known?'known':'unknown');cases++;
 }for(const setup of [{playbookKey:'breakout_volume',evidence:{}},{playbookKey:'breakout_volume'}]){const signal={isDuplicate:false,shouldCallGroq:false,reason:'fixture',setupResult:setup};await assert.rejects(run('baseline',signal));const fixed=await run('release',signal);assert.equal(fixed.result.decision,'no_trade');assert.equal(fixed.result.trace.setup_identity.status,'unknown');}
const report={cases,earlyReturnDecisionParity:true,identityPropagation:true,missingEvidenceRegressionCases:2,noNetworkOrDatabase:true};fs.writeFileSync(path.join(root,'compiled-dispatch-early-tests.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));})().catch(e=>{console.error(e);process.exitCode=1;});

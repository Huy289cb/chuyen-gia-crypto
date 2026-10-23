const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const [pack,report]=process.argv.slice(2);if(!pack||!report)throw Error('PACKAGE NEW_REPORT');
const now=Date.parse('2026-10-03T00:00:00Z');class Clock extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
function load(rel,require){const m={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(pack,'release',rel),'utf8'),{module:m,exports:m.exports,require});return m.exports;}
const math=load('utils/account-drawdown-percent.js'),adapter=load('utils/recorded-account-circuit-mutation.js',()=>math);
async function run(folder,f){const writes=[],events=[];const account={id:1,starting_balance:40,current_balance:f.equity??40,equity:f.equity??40,max_drawdown:f.previousDD??0,cooldown_until:f.until??null};
 const policy={circuitPeakEquityOverride:40,circuitExpectancySince:null,circuitDailyLossEnabled:true,dailyLossLimitPercent:10,circuitDrawdownEnabled:true,maxDrawdownPercent:15,circuitExpectancyKillEnabled:true,circuitExpectancyWindow:10,circuitExpectancyMinSumR:-3,circuitExpectancyCooldownHours:1,...f.policy};
 const deps={'../lib/prisma':{prisma:{testnetAccount:{findUnique:async()=>account,update:async v=>{if(f.dbFail)throw Error('write failed');writes.push(JSON.parse(JSON.stringify(v)));}},testnetAccountSnapshot:{findFirst:async()=>({equity:40}),aggregate:async()=>({_max:{equity:40}})},tradeOutcome:{findMany:async()=>[]}}},'../config/risk-policy':{getRiskPolicy:()=>policy},'../utils/ict-time':{getDayBoundsICT:()=>({dayStart:new Clock(now-1000)})},'./expectancy-rollup.service':{rollupExpectancyFromOutcomes:()=>f.expectancy??({n:0,sumR:0,avgR:0,profitFactor:null})},'../utils/account-drawdown-percent':math,'node:crypto':{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},'../utils/account-wallet-journal':{persistAccountWalletObservation:async(e,t)=>{events.push({e,t});if(f.pending)return new Promise(()=>{});if(f.reject)throw Error('journal failed');}}};
 const mod={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(pack,folder,'services/account-circuit.service.js'),'utf8'),{module:mod,exports:mod.exports,Date:Clock,console:{log:()=>{},warn:()=>{}},require:id=>{assert.ok(id in deps,id);return deps[id];}});
 let result;try{result=f.cooldown?await mod.exports.applyExpectancyKillCooldownIfNeeded(1,f.status??{allowed:false,reason:'Expectancy kill: fixture'}):await mod.exports.getAccountCircuitStatus(1);}catch(e){result={error:e.message};}
 await Promise.resolve();await Promise.resolve();return{result:result===undefined?null:JSON.parse(JSON.stringify(result)),writes,events,exports:mod.exports};}
(async()=>{let cases=0,payloads=0;const fixtures=[];for(const equity of [40,39,36,30,0])for(const previousDD of [0,25])fixtures.push({equity,previousDD});for(const until of [null,new Date(now-1),new Date(now+3600000),new Date(now+7200000),new Date('invalid')])fixtures.push({cooldown:true,until});for(const opt of ['dbFail','pending','reject']){fixtures.push({equity:30,[opt]:true},{cooldown:true,[opt]:true});}
fixtures.push(
 {expectancy:{n:10,sumR:-4,avgR:-0.4,profitFactor:0}},
 {expectancy:{n:9,sumR:-4,avgR:-4/9,profitFactor:0}},
 {expectancy:{n:10,sumR:-2,avgR:-0.2,profitFactor:0}},
 {cooldown:true,status:{allowed:true,reason:'clear'}},
 {cooldown:true,status:{allowed:false,reason:'Drawdown circuit blocked'}},
 {cooldown:true,policy:{circuitExpectancyCooldownHours:0}}
 );
for(const f of fixtures){const a=await run('baseline',f),b=await run('release',f);assert.deepEqual(b.result,a.result);assert.deepEqual(b.writes,a.writes);for(const {e,t}of b.events){assert.equal(t,'account_circuit_mutation_applied');const r=adapter.replayRecordedAccountCircuitMutation(e,now,now);if(f.until&&!Number.isFinite(f.until.getTime()))assert.equal(r.status,'unknown');else{assert.equal(r.status,'evaluated');assert.equal(r.matches_recorded,true);}payloads++;}for(const p of [0,30,40])for(const eq of [-1,0,30,40,45])assert.equal(b.exports.calcDrawdownPercent(p,eq),a.exports.calcDrawdownPercent(p,eq));cases++;}
fs.writeFileSync(report,JSON.stringify({passed:true,cases,payloads,runtimeDeployed:false,limits:'Compiled service fixtures; not full engine/query completeness/economic ROI'},null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({passed:true,cases,payloads}));})().catch(e=>{console.error(e);process.exitCode=1;});

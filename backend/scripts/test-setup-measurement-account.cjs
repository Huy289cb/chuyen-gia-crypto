const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]);
async function run(tree,scenario){
 const stages=[],writes=[],file=path.join(root,tree,'services/account-risk-guard.service.js');
 const account={id:1,current_balance:31.4,equity:31.4,consecutive_losses:0,cooldown_until:scenario==='cooldown'?new Date('2099-01-01'):null};
 const circuit={allowed:scenario!=='circuit',reason:scenario==='circuit'?'Daily loss circuit':'circuits clear',startEquity:31.4,dailyLossUsd:0,dailyLossLimitPercent:10};
 const m=new Module(file,module);m.filename=file;
 m.require=id=>{
 if(id==='../lib/prisma')return {prisma:{testnetAccount:{findUnique:async()=>account,update:async q=>{writes.push(q);return account;}}}};
 if(id==='../config/risk-policy')return {getRiskPolicy:()=>({maxConsecutiveLosses:2,dailyLossLimitPercent:10}),resolveLossCooldownUntil:()=>null};
 if(id==='../repositories/testnet.repository')return {setTestnetAccountCooldown:async()=>{}};
 if(id==='./binance-trade-history.service')return {getBinanceLossStreak:async()=>{throw Error('unexpected_exchange');}};
 if(id==='./protective-exposure-state')return {getProtectiveExposureEntryBlock:()=>scenario==='protective'?{reason:'missing SL'}:null};
 if(id==='./account-circuit.service')return {getAccountCircuitStatus:async()=>circuit,applyExpectancyKillCooldownIfNeeded:async()=>{}};
 if(id==='../utils/entry-trace')return {recordEntryStage:async(stage,data)=>stages.push({stage,data})};
 throw Error('unapproved_import:'+id);
 };m._compile(fs.readFileSync(file,'utf8'),file);
 return {result:await m.exports.assertTestnetAccountCanOpenTrade(1,'BTC'),writes,stages};
}
(async()=>{const prior=process.env.BINANCE_ENABLED;process.env.BINANCE_ENABLED='false';try{for(const scenario of ['clear','cooldown','protective','circuit']){const a=await run('baseline',scenario),b=await run('release',scenario);assert.deepStrictEqual(b.result,a.result);assert.deepStrictEqual(b.writes,a.writes);assert.equal(b.stages[0].stage,'account_guard_inputs');assert.equal(b.stages.length,['clear','circuit'].includes(scenario)?2:1);}}finally{if(prior===undefined)delete process.env.BINANCE_ENABLED;else process.env.BINANCE_ENABLED=prior;}console.log(JSON.stringify({cases:4,accountDecisionAndWritesParity:true,noDatabaseOrExchange:true}));})().catch(e=>{console.error(e);process.exitCode=1;});

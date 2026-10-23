// Replay deployed circuit on recorded SELECT results. No DB/exchange imports are allowed.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
const [source,out]=process.argv.slice(2);if(!out)throw Error('Usage: SNAPSHOT NEW_REPORT');
const bytes=fs.readFileSync(source),s=JSON.parse(bytes),file=path.resolve(__dirname,'../dist/services/account-circuit.service.js');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(sha(fs.readFileSync(file))!==s.codeHashes['services/account-circuit.service.js'])throw Error('circuit_version_changed');
const suppressedWrites=[];
const prisma={
 testnetAccount:{findUnique:async()=>s.account,update:async q=>{
  if(Object.keys(q.data).join(',')!=='max_drawdown')throw Error('unexpected_mutation');
  suppressedWrites.push(q);return {...s.account,...q.data};}},
 testnetAccountSnapshot:{aggregate:async()=>({_max:{equity:s.snapshotPeak}}),findFirst:async q=>{
  const cutoff=+new Date(q.where.timestamp.lt);
  if(cutoff===+new Date(s.dayStart))return s.dailyBaseline;
  if(cutoff===+new Date(s.policy.circuitExpectancySince))return s.epochBaseline;
  throw Error('unrecorded_query');}},
 tradeOutcome:{findMany:async()=>s.outcomes},
};
const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
m.require=id=>{
 if(id==='../lib/prisma')return {prisma};
 if(id==='../config/risk-policy')return {getRiskPolicy:()=>({...s.policy,circuitExpectancySince:s.policy.circuitExpectancySince?new Date(s.policy.circuitExpectancySince):null})};
 if(id==='../utils/ict-time')return {getDayBoundsICT:()=>({dayStart:new Date(s.dayStart)})};
 if(id==='./expectancy-rollup.service')return require(path.join(path.dirname(file),'expectancy-rollup.service.js'));
 throw Error('unapproved_import:'+id);
};
m._compile(fs.readFileSync(file,'utf8'),file);
(async()=>{
 const status=await m.exports.getAccountCircuitStatus(s.account.id);
 const report={schema:'recorded-circuit-audit-v1',sourceSha256:sha(bytes),circuitHash:sha(fs.readFileSync(file)),status,suppressedWrites,
  remainingDailyRiskUsd:Math.max(0,status.startEquity*s.policy.dailyLossLimitPercent/100-status.dailyLossUsd),
  limits:'Deployed circuit executed on captured DB results; not full admission/portfolio parity. max_drawdown write captured only, never persisted.'};
 fs.writeFileSync(out,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({allowed:status.allowed,reason:status.reason,drawdown:status.drawdownPercent,remainingDailyRiskUsd:report.remainingDailyRiskUsd}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});

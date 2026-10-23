// Bounded circuit component comparison; all DB writes are intercepted.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto'),assert=require('node:assert/strict'),ts=require('typescript');
require('tsx/cjs');
const [snapshotPath,frozenRuntime,variantsPath,out]=process.argv.slice(2);
if(!out)throw Error('Usage: SNAPSHOT FROZEN_RUNTIME VARIANTS NEW_REPORT');
const s=JSON.parse(fs.readFileSync(snapshotPath)),variants=JSON.parse(fs.readFileSync(variantsPath));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const oldFile=path.resolve(frozenRuntime,'services/account-circuit.service.js');
const oldCode=fs.readFileSync(oldFile,'utf8');
if(sha(oldCode)!==s.codeHashes['services/account-circuit.service.js'])throw Error('recorded_circuit_hash_mismatch');
const newFile=path.resolve(__dirname,'../src/services/account-circuit.service.ts');
const newCode=ts.transpileModule(fs.readFileSync(newFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function run(file,code,policy){
 const writes=[];
 const prisma={testnetAccount:{findUnique:async()=>s.account,update:async q=>{if(Object.keys(q.data).join(',')!=='max_drawdown')throw Error('unexpected_write');writes.push(q);return {...s.account,...q.data};}},testnetAccountSnapshot:{aggregate:async()=>({_max:{equity:s.snapshotPeak}}),findFirst:async q=>{const cutoff=+new Date(q.where.timestamp.lt);if(cutoff===+new Date(s.dayStart))return s.dailyBaseline;if(cutoff===+new Date(policy.circuitExpectancySince))return s.epochBaseline;throw Error('unrecorded_query');}},tradeOutcome:{findMany:async()=>s.outcomes}};
 const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
 m.require=id=>{if(id==='../lib/prisma')return {prisma};if(id==='../config/risk-policy')return {getRiskPolicy:()=>({...policy,circuitExpectancySince:policy.circuitExpectancySince?new Date(policy.circuitExpectancySince):null})};if(id==='../utils/ict-time')return {getDayBoundsICT:()=>({dayStart:new Date(s.dayStart)})};if(id==='./expectancy-rollup.service')return require(path.resolve(frozenRuntime,'services/expectancy-rollup.service.js'));if(id==='../utils/account-circuit-evaluation')return require('../src/utils/account-circuit-evaluation.ts');throw Error('unapproved_import:'+id);};
 m._compile(code,file);return {status:await m.exports.getAccountCircuitStatus(s.account.id),writes};
}
(async()=>{const cases=[];for(const variant of Object.values(variants.variants)){const baseline=await run(oldFile,oldCode,variant.policy),current=await run(newFile,newCode,variant.policy);assert.deepStrictEqual(current,baseline);cases.push({variant:variant.id,equal:true,status:current.status,suppressedWrites:current.writes});}fs.writeFileSync(out,JSON.stringify({schema:'roi-upgrade-circuit-component-parity-v1',frozenCircuitSha256:sha(oldCode),sourceSha256:sha(fs.readFileSync(newFile)),snapshotSha256:sha(fs.readFileSync(snapshotPath)),cases,limits:'Two policies on one recorded circuit state only. No full admission, historical portfolio, lifecycle or ROI parity; no DB/exchange connection.'},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({equal:true,cases:cases.length}));})().catch(e=>{console.error(e);process.exitCode=1;});

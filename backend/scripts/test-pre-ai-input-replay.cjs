'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm'),ts=require('typescript');
require('tsx/cjs');
const root=path.resolve(__dirname,'..');
const observe=require('../src/utils/entry-feasibility-observation.ts').observeEntryFeasibility;
const closed=require('../src/utils/closed-candles.ts');
const oldObserve=require('../dist/utils/entry-feasibility-observation.js').observeEntryFeasibility;
const {assessPreAiPlanning}=require('./assess-canonical-baseline.cjs');
const src=fs.readFileSync(path.join(root,'src/services/groq-dispatch.service.ts'),'utf8');
const old=fs.readFileSync(path.join(root,'dist/services/groq-dispatch.service.js'),'utf8');
const nextBlock=src.slice(src.indexOf('    // Freeze the exact diagnostic inputs'),src.indexOf("    await recordEntryStage('pre_ai_passed'"));
const oldBlock=old.slice(old.indexOf("        await (0, entry_trace_1.recordEntryStage)('feasibility_before_ai'"),old.indexOf("        await (0, entry_trace_1.recordEntryStage)('pre_ai_passed'"));
assert(nextBlock&&oldBlock);
const nextJs=ts.transpileModule(nextBlock,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
async function emit(block,bindings){const emitted=[];const record=async(stage,data)=>{if(data.input){assert.notEqual(data.input.candles,bindings.candles);assert.notEqual(data.input.candles[0],bindings.candles[0]);assert.notEqual(data.input.structureCandles,bindings.diagnosticStructure);}emitted.push({stage,...JSON.parse(JSON.stringify(data))});};await vm.runInNewContext('(async()=>{'+block+'})()', {...bindings,recordEntryStage:record,entry_trace_1:{recordEntryStage:record}});return emitted[0];}
(async()=>{
 let cases=0;const previous=process.env.CLOSED_CANDLE_FINALIZATION_GRACE_MS;
 try{
 for(const side of ['long','short',null])for(const graceMs of [0,5000,45000])for(const confirmed of [false,true]){
  process.env.CLOSED_CANDLE_FINALIZATION_GRACE_MS=String(graceMs);
  const asOf=14400000*12+5000;
  const make=(step,n)=>Array.from({length:n},(_,j)=>({timestamp:Math.floor(asOf/step)*step-(n-1-j)*step,high:105+(j%3),low:95-(j%3),close:100,volume:55,open:100}));
  const candles=make(300000,14),structure=make(14400000,12);
  const bindings={Date:{now:()=>asOf},timeframe:'5m',candles,diagnosticStructure:structure,playbookSide:side,retestContext:confirmed?{confirmedEntryPrice:100,minRr:2}:null,optimizedRangeRetest:confirmed,method_id:'fixture',getV3StructureBiasTf:()=> '4h',getRiskPolicy:()=>({minSlDistancePercent:.008}),getMethodConfig:()=>({autoEntry:{minRRRatio:3}}),getClosedCandleFinalizationGraceMs:closed.getClosedCandleFinalizationGraceMs,observeEntryFeasibility:observe};
  const oldBindings={...bindings,closed_candles_1:closed,entry_feasibility_observation_1:{observeEntryFeasibility:oldObserve},v3_structure_bias_policy_1:{getV3StructureBiasTf:bindings.getV3StructureBiasTf},risk_policy_1:{getRiskPolicy:bindings.getRiskPolicy},methods_1:{getMethodConfig:bindings.getMethodConfig}};
  const before=await emit(oldBlock,oldBindings),after=await emit(nextJs,bindings);
  assert.deepEqual(after.measurement,before.measurement);
  if(process.argv[2]){
   const pkg=path.resolve(process.argv[2]),compiled=fs.readFileSync(path.join(pkg,'release/services/groq-dispatch.service.js'),'utf8');
   const a=compiled.indexOf('// Freeze the exact diagnostic inputs'),b=compiled.indexOf("        await (0, entry_trace_1.recordEntryStage)('pre_ai_passed'",a);
   assert(a>=0&&b>a);
   const actual=await emit(compiled.slice(a,b),{...oldBindings,entry_feasibility_observation_1:require(path.join(pkg,'release/utils/entry-feasibility-observation.js'))});
   assert.deepEqual(actual,after);
  }
  process.env.CLOSED_CANDLE_FINALIZATION_GRACE_MS='999999999';
  const event={id:1,event_type:'entry_trace',event_data:{trace_id:'fixture',...after}};
  const assessed=assessPreAiPlanning([event],asOf);
  assert.equal(assessed.rows[0].status,'exact_diagnostic_reconciled');
  assert.equal(assessed.rows[0].full_structural_plan,null);
  const bad=JSON.parse(JSON.stringify(event));bad.event_data.measurement.status='tampered';assert.equal(assessPreAiPlanning([bad],asOf).rows[0].status,'mismatch');
  const missing=JSON.parse(JSON.stringify(event));delete missing.event_data.input.graceMs;assert.equal(assessPreAiPlanning([missing],asOf).rows[0].reason,'invalid_exact_diagnostic_input');
  const future=JSON.parse(JSON.stringify(event));future.event_data.measurement.asOf=asOf+1;assert.equal(assessPreAiPlanning([future],asOf).rows[0].reason,'invalid_or_future_diagnostic');
  const originalValue=after.input.candles[0].low;candles[0].low=1;assert.equal(after.input.candles[0].low,originalValue);
  cases++;
 }
 }finally{if(previous===undefined)delete process.env.CLOSED_CANDLE_FINALIZATION_GRACE_MS;else process.env.CLOSED_CANDLE_FINALIZATION_GRACE_MS=previous;}
 console.log(JSON.stringify({cases,actualDeployedStageAndDiagnosticCompared:true,sourceStageReplay:true,environmentIndependentReplay:true,corruptionMissingGraceAndFutureRejected:true,noNetworkOrDatabase:true,sealedCompiledStageCompared:!!process.argv[2],fullDispatcherParity:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});

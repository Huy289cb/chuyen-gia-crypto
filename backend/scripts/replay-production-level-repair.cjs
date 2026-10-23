// Offline actual compiled adapter; dependency allowlist prevents provider/DB I/O.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),crypto=require('crypto');
const [telemetryFile,out]=process.argv.slice(2);if(!out||fs.existsSync(out))throw Error('TELEMETRY NEW_REPORT');
const bytes=fs.readFileSync(telemetryFile),events=JSON.parse(bytes).events,file=path.resolve(__dirname,'../dist/services/groq-levels-adapter.service.js'),code=fs.readFileSync(file,'utf8'),levels=require('../dist/utils/trade-levels.js');
async function replay(analysis,minRr,configured=true){
 let providerAttempts=0;const logs=[],module={exports:{}};
 const deps={'./groq-client':{},'../utils/trade-levels':levels,'../config/methods':{getMethodConfig:()=>({autoEntry:{minRRRatio:minRr}})},'../config/risk-policy':{getRiskPolicy:()=>({minSlDistancePercent:.008})},'../config/groq-models':{},'../config/openrouter-models':{isOpenRouterLevelsAdapterProvider:()=>false},'../utils/provider-purpose-context':{withProviderPurpose:async()=>{providerAttempts++;throw Error('offline_provider_boundary');}}};
 vm.runInNewContext(code,{module,exports:module.exports,process:{env:{GROQ_LEVELS_ADAPTER_ENABLED:configured?'true':'false',GROQ_API_KEY_2:'offline-fixture'}},console:{warn:(...a)=>logs.push(a.join(' '))},require:id=>{if(!Object.hasOwn(deps,id))throw Error('unmocked_dependency:'+id);return deps[id];}},{filename:file});
 const result=await module.exports.tryRepairLevelsWithSecondaryKey({symbol:'BTC',timeframe:'5m',methodId:'kim_nghia',analysis});
 return {result,providerAttempts,logs};
}
(async()=>{
 const results=[];
 for(const e of events.filter(e=>e.event_data.stage==='plan_geometry')){
  const d=e.event_data,minRr=d.measurement.requiredTargetFraction/.008,action=d.take_profit>d.entry?'buy':'sell';
  const analysis={action,suggested_entry:d.entry,suggested_stop_loss:d.stop_loss,suggested_take_profit:d.take_profit};
  const r=await replay(analysis,minRr),floor=levels.computePolicyCompliantStopAndTarget({action,entry:d.entry,minSlPct:.008,minRr});
  assert.equal(r.result,null);assert.equal(r.providerAttempts,0);assert(r.logs.some(l=>l.includes('Original structural target cannot support')));
  const positive=await replay({...analysis,suggested_take_profit:action==='buy'?floor.takeProfit+1:floor.takeProfit-1},minRr);assert.equal(positive.providerAttempts,1);
  results.push({event_id:e.id,trace_id:d.trace_id,analysis,minRr,policy_floor:floor,maximum_rr_at_floor:Math.abs(d.take_profit-d.entry)/(d.entry*.008),outcome:'structural_target_cannot_support_floor_and_rr',provider_attempts:0,positive_control_provider_boundary_reached:true});
 }
 assert.equal(results.length,5);
 const disabled=await replay(results[0].analysis,3,false);assert.equal(disabled.providerAttempts,0);assert.equal(disabled.result,null);
 const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
 fs.writeFileSync(out,JSON.stringify({schema:'compiled-production-level-repair-replay-v1',telemetry_sha256:sha(bytes),deployed_adapter_sha256:sha(code),deployed_trade_levels_sha256:sha(fs.readFileSync(path.resolve(__dirname,'../dist/utils/trade-levels.js'))),cases:results.length,results,disabled_control_passed:true,configured_gate_forced_for_isolating_geometry:true,policy_from_recorded_measurement:true,provider_calls:0,db_writes:0,live_orders:0,economic_roi:null,limits:'Observed primary proposals only, not structural stop construction, actual repair configuration/call outcome or counterfactual profitability. Positive controls alter targets solely to test control flow, not eligible strategy candidates.'},null,2),{flag:'wx',mode:0o600});console.log({cases:results.length,allGeometricallyUnrepairable:true,providerCalls:0});
})().catch(e=>{console.error(e);process.exitCode=1;});

// Offline attribution of recorded stages, NOT a strategy simulator or admission authority.
const fs=require('node:fs'),crypto=require('node:crypto');
function buildJournal(input){
 const traces=new Map();let unlinked=0;
 for(const e of input.events||[]){
  if(e.event_type!=='entry_trace')continue;
  const d=e.event_data;
  if(!d||typeof d.trace_id!=='string'){unlinked++;continue;}
  if(!traces.has(d.trace_id))traces.set(d.trace_id,[]);
  traces.get(d.trace_id).push(e);
 }
 const attempts=[...traces].map(([traceId,events])=>{
  events.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)||a.id-b.id);
  const unique=k=>[...new Set(events.map(e=>e.event_data[k]).filter(v=>v!==undefined&&v!==null))];
  const candidates=unique('candidate_key'),codes=unique('code_hash'),policies=unique('policy_hash');
  const stage=name=>events.filter(e=>e.event_data.stage===name);
  const plans=stage('plan_geometry'),results=stage('dispatch_result');
  const terminal=results.at(-1),reason=terminal?.event_data.reason;
  let planOutcome='not_observed';
  if(plans.length){
   planOutcome='unknown';
   if(stage('admission_started').length)planOutcome='admission_reached';
   else if(terminal?.event_data.decision==='no_trade'&&typeof reason==='string'){
    if(reason.includes('(V3_REQUIRE_PULLBACK)'))planOutcome='pullback_gate';
    else if(/^Risk engine blocked: R:R .* below minimum /.test(reason))planOutcome='rr_geometry';
    else if(/^Risk engine blocked: SL distance .* below min /.test(reason))planOutcome='sl_floor_geometry';
    else planOutcome='other_recorded_veto';
   }
  }
  const checks=stage('risk_checked').map(e=>{
   const d=e.event_data,finite=k=>typeof d[k]==='number'&&Number.isFinite(d[k])&&d[k]>=0;
   return {eventId:e.id,asOf:e.timestamp,totalRiskUsd:d.totalRiskUsd??null,capUsd:d.cap_usd??null,
    tradeRisk:finite('totalRiskUsd')&&finite('cap_usd')?(d.totalRiskUsd>d.cap_usd+1e-9?'blocked':'within_cap'):'unknown',
    dailyRisk:finite('totalRiskUsd')&&finite('remaining_daily_risk_usd')?(d.totalRiskUsd>d.remaining_daily_risk_usd+1e-9?'blocked':'within_budget'):'unknown',
    remainingDailyRiskUsd:d.remaining_daily_risk_usd??null};
  });
  return {traceId,candidateKey:candidates.length===1?candidates[0]:null,identityConflict:candidates.length>1,
   codeHashes:codes,policyHashes:policies,versionKnown:codes.length===1&&policies.length===1,
   firstAt:events[0].timestamp,lastAt:events.at(-1).timestamp,eventIds:events.map(e=>e.id),
   stages:events.map(e=>e.event_data.stage),riskChecks:checks,
   planAttribution:{outcome:planOutcome,planEventIds:plans.map(e=>e.id),terminalEventId:terminal?.id??null,reason:reason??null,
    basis:'recorded same-trace outcome; not counterfactual profitability'},
   quantityChecks:stage('quantity_checked').map(e=>({eventId:e.id,asOf:e.timestamp,...e.event_data})),
   rejections:stage('admission_rejected').map(e=>({eventId:e.id,code:e.event_data.rejection_code??'unknown',reason:e.event_data.reason??null})),
   orderIds:unique('order_id'),accountAdmission:'unknown: full contemporaneous guard state not recorded'};
 });
 const groups=new Map();
 for(const a of attempts){
  // Version isolation prevents pooling changed strategies; absent identity never implies independence.
  if(!a.candidateKey||!a.versionKnown)continue;
  const key=JSON.stringify([a.candidateKey,a.codeHashes[0],a.policyHashes[0]]);
  if(!groups.has(key))groups.set(key,{candidateKey:a.candidateKey,codeHash:a.codeHashes[0],policyHash:a.policyHashes[0],traceIds:[]});
  groups.get(key).traceIds.push(a.traceId);
 }
 const checks=attempts.flatMap(a=>a.riskChecks);
 return {schema:'candidate-feasibility-journal-v1',interval:{since:input.since,through:input.through},
  coverage:{traceAttempts:attempts.length,unlinkedTraceEvents:unlinked,attemptsWithCandidateKey:attempts.filter(a=>a.candidateKey).length,
   versionedCandidateGroups:groups.size,attemptsWithRiskCheck:attempts.filter(a=>a.riskChecks.length).length,
   tradeRiskBlockedChecks:checks.filter(c=>c.tradeRisk==='blocked').length,dailyRiskUnknownChecks:checks.filter(c=>c.dailyRisk==='unknown').length,
   independentSetups:'unknown: candidate keys are not verified wave identities',upstreamInventory:'unknown: only persisted entry traces'},
  groups:[...groups.values()],attempts,
  planFunnel:attempts.filter(a=>a.planAttribution.outcome!=='not_observed').reduce((counts,a)=>{
   const key=a.planAttribution.outcome;counts[key]=(counts[key]||0)+1;return counts;
  },{}),
  limits:['No current balance or financial snapshot is backfilled into historical attempts.','Within risk cap does not mean order admissible or profitable.','Groups deduplicate candidate keys within versions only; do not sum them as independent opportunities.','Missing stages, costs, account guards and pre-dispatch candidates remain unknown.']};
}
module.exports={buildJournal};
if(require.main===module){
 const [source,out]=process.argv.slice(2);if(!source||!out)throw Error('Usage: node candidate-feasibility-journal.cjs EXPORT NEW_OUTPUT');
 const bytes=fs.readFileSync(source),report=buildJournal(JSON.parse(bytes));
 report.sourceSha256=crypto.createHash('sha256').update(bytes).digest('hex');
 report.scriptSha256=crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
 fs.writeFileSync(out,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report.coverage,null,2));
}

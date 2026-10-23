import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve(__dirname,'../..'),out=path.join(root,'docs/audits/2026-10-07-causal-quality');
const read=(p:string)=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));

async function main(){
  Object.assign(process.env,read('docs/audits/2026-10-04-continuous-causal-portfolio/policy.json').environment,
    {CAUSAL_OPPORTUNITY_RESEARCH_ENABLED:'true',CAUSAL_SETUP_SCORING_VERSION:'rejection-volume-v1'});
  const [{SignalGateService},{sealCausalPlan},{inferSetupTradeSide},{evaluatePreAiEntryGates},{evaluateStructureSidePermission},{analyzeSetupGate}]=await Promise.all([
    import('../src/services/signal-gate.service'),import('../src/utils/causal-plan-contract'),import('../src/utils/setup-trade-side'),
    import('../src/utils/pre-ai-entry-gates'),import('../src/config/v3-structure-bias-policy'),import('../src/analyzers/setup-gate.analyzer')]);
  const data=read('docs/audits/2026-09-11-opportunity-testbed/train-data.json');
  const durations={hour:3600000,five:300000,fifteen:900000,fourHour:14400000};
  const tfs={hour:'1h',five:'5m',fifteen:'15m',fourHour:'4h'};
  const all=Object.fromEntries(Object.entries(tfs).map(([key,tf])=>[key,data.byTf[tf].map((b:number[])=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}))]));
  const gate=new SignalGateService({minGrade:'B',minConfidence:.70,enableDuplicateFilter:false,allowedRegimes:['trend']});
  const rows:any[]=[],counts:Record<string,number>={};const originalNow=Date.now;
  try {
    for(const mechanism of ['H1','H2'] as const){
      for(const row of read(`docs/audits/2026-10-04-${mechanism.toLowerCase()}-feasibility/inventory.json`).filter((r:any)=>r.window&&r.status==='plan')){
        const c=row.candidate,p=row.plan,at=row.resolvedAt,child=mechanism==='H1'?'fifteen':'five',tf=tfs[child];
        Date.now=()=>at;
        const bars:any=Object.fromEntries(Object.entries(durations).map(([key,d])=>[key,all[key].filter((b:any)=>b.timestamp+d+5000<=at)]));
        bars.hour=bars.hour.slice(-104);bars.five=bars.five.slice(-100);bars.fifteen=bars.fifteen.slice(-100);
        const plan=sealCausalPlan({version:'h1-h2-review-v1',setupId:c.id,mechanism,symbol:'BTC',timeframe:tf,side:c.side,knownAt:c.knownAt,expiresAt:c.expiresAt,entry:p.entry,stop:c.side==='long'?Math.floor(p.stop*10)/10:Math.ceil(p.stop*10)/10,target:p.target,invalidation:p.invalidation,minRr:1.5});
        const scans:any={};
        for(const [tf,key]of [['1h','hour'],['4h','fourHour']])scans[tf]=await analyzeSetupGate({symbol:'BTC',timeframe:tf,candles:bars[key].slice(-100)});
        const signal=await gate.evaluate({symbol:'BTC',timeframe:tf,candles:bars[child],causalPlan:plan,causalEvidence:{at,bars},htfRegime:scans['1h'].regime});
        const side=inferSetupTradeSide(signal.setupResult,tf,bars[child]);
        const preAi=evaluatePreAiEntryGates({optimizedRangeRetest:false,timeframe:tf,gateRegime:signal.gateRegime??signal.setupResult.regime,
          grade:signal.setupResult.grade,confidence:signal.setupResult.confidence,playbookKey:signal.setupResult.playbookKey,playbookSide:side,
          scanState:tf=>({fresh:!!scans[tf],regime:scans[tf]?.regime??'unknown'})});
        const structure=evaluateStructureSidePermission({side:c.side,candles:bars.fourHour.slice(-120)});
        const rr=Math.abs(plan.target-plan.entry)/Math.abs(plan.entry-plan.stop),rrPass=rr>=plan.minRr;
        const eligible=signal.pass&&side===c.side&&preAi.pass&&structure.pass&&rrPass&&row.financial.cap5_pass;
        const k=`${mechanism}:${signal.setupResult.grade}`;counts[k]=(counts[k]??0)+1;
        rows.push({mechanism,setup_id:c.id,at,plan,grade:signal.setupResult.grade,rule_quality:signal.setupResult.confidence,raw:signal.setupResult.evidence.playbooks[0].metrics,
          local_regime:signal.setupResult.regime,gate_regime:signal.gateRegime,signal_pass:signal.pass,signal_reason:signal.reason,side,pre_ai:preAi,structure,rr,rr_pass:rrPass,cap5_raw_geometry_pass:row.financial.cap5_pass,eligible_direct_prefix:eligible});
      }
    }
  }finally {Date.now=originalNow;}
  assert.equal(rows.length,67);
  const files=['docs/audits/2026-10-07-causal-quality/registration.md','backend/src/analyzers/causal-setup-gate.analyzer.ts','backend/src/services/signal-gate.service.ts','backend/src/services/groq-dispatch.service.ts','backend/src/utils/setup-trade-side.ts'];
  const hashes=Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
  const survivors=rows.filter(r=>r.eligible_direct_prefix).map(r=>r.setup_id);
  const result={scope:'registered deterministic closed-prefix diagnostics; not cached scheduler/full workflow/account/ROI/fills',policy_source:'2026-10-04-continuous-causal-portfolio/policy.json',counts,signal_pass:rows.filter(r=>r.signal_pass).length,pre_ai_survivors:rows.filter(r=>r.signal_pass&&r.pre_ai.pass&&r.side===r.plan.side).length,eligible_direct_prefix:survivors,
    decision:survivors.length?'probe_actual_frozen_workflow':'infeasible_registered_rubric_with_retained_guards_stop_without_rescue',provider_calls:0,hashes,rows};
  fs.writeFileSync(path.join(out,'measurement.json'),JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify({counts,signal_pass:result.signal_pass,pre_ai_survivors:result.pre_ai_survivors,survivors,decision:result.decision}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});

import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {sealCausalPlan} from '../src/utils/causal-plan-contract';
import {revalidateCausalPlan,type CausalPlanEvidence} from '../src/utils/causal-plan-evidence';

const root=path.resolve(__dirname,'../..'),out=path.join(root,'docs/audits/2026-10-07-causal-evidence');
const read=(p:string)=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const data=read('docs/audits/2026-09-11-opportunity-testbed/train-data.json');
const durations={hour:3600000,five:300000,fifteen:900000,fourHour:14400000};
const tfs={hour:'1h',five:'5m',fifteen:'15m',fourHour:'4h'};
const all=Object.fromEntries(Object.entries(tfs).map(([k,tf])=>[k,data.byTf[tf].map((b:number[])=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}))]));
const require=createRequire(import.meta.url);
const frozen=require(path.join(root,'docs/audits/2026-10-04-causal-workflow-runtime/runtime/analyzers/setup-gate.analyzer.js'));
const previous=read('docs/audits/2026-10-04-causal-gate-compatibility/assessment.json');
const counts:Record<string,number>={},rows:any[]=[],checks:Record<string,number>={};
function check(label:string,value:unknown,expected:unknown){assert.equal(value,expected,label);checks[label]=(checks[label]??0)+1;}
async function main(){
for(const mechanism of ['H1','H2'] as const){
 const inventory=read(`docs/audits/2026-10-04-${mechanism.toLowerCase()}-feasibility/inventory.json`);
 for(const row of inventory.filter((r:any)=>r.window&&r.status==='plan')){
  const c=row.candidate,p=row.plan,at=row.resolvedAt,child=mechanism==='H1'?'fifteen':'five',tf=tfs[child];
  const evidence:CausalPlanEvidence={at,bars:Object.fromEntries(Object.entries(durations).map(([key,d])=>[key,all[key].filter((b:any)=>b.timestamp+d+5000<=at)])) as CausalPlanEvidence['bars']};
  const plan=sealCausalPlan({version:'h1-h2-review-v1',setupId:c.id,mechanism,symbol:'BTC',timeframe:tf,side:c.side,knownAt:c.knownAt,expiresAt:c.expiresAt,entry:p.entry,stop:c.side==='long'?Math.floor(p.stop*10)/10:Math.ceil(p.stop*10)/10,target:p.target,invalidation:p.invalidation,minRr:1.5});
  const result=await frozen.analyzeSetupGate({symbol:'BTC',timeframe:tf,candles:evidence.bars[child].slice(-100)});
  const prior=previous.rows.find((r:any)=>r.setup_id===c.id&&r.mechanism===mechanism);
  assert.deepEqual({grade:result.grade,confidence:result.confidence,playbook:result.playbookKey,regime:result.regime,evidence:result.evidence},
    {grade:prior.grade,confidence:prior.confidence,playbook:prior.playbook,regime:prior.regime,evidence:prior.evidence});
  const key=`${mechanism}:${result.grade}:${result.playbookKey??'none'}`;counts[key]=(counts[key]??0)+1;
  check('archive_geometry_reconstructed',revalidateCausalPlan(plan,evidence,at),null);
  check('missing_evidence',revalidateCausalPlan(plan,undefined,at),'causal_evidence_missing_or_clock_mismatch');
  check('resealed_target',revalidateCausalPlan(sealCausalPlan({...plan,target:plan.target+(plan.side==='long'?1:-1)}),evidence,at),'causal_evidence_geometry_mismatch');
  check('resealed_identity',revalidateCausalPlan(sealCausalPlan({...plan,setupId:'fake'}),evidence,at),'causal_evidence_candidate_mismatch');
  check('resealed_stop',revalidateCausalPlan(sealCausalPlan({...plan,stop:plan.stop+(plan.side==='long'?-1:1)}),evidence,at),'causal_evidence_geometry_mismatch');
  const gap=structuredClone(evidence);gap.bars.hour.splice(-3,1);
  check('gap_history',revalidateCausalPlan(plan,gap,at),'causal_evidence_invalid_history');
  const future=structuredClone(evidence);const last=future.bars[child].at(-1)!;future.bars[child].push({...last,timestamp:last.timestamp+durations[child]});
  check('future_history',revalidateCausalPlan(plan,future,at),'causal_evidence_invalid_history');
  const invalid=structuredClone(evidence);invalid.bars.hour.at(-1)!.volume=NaN;
  check('nonfinite_history',revalidateCausalPlan(plan,invalid,at),'causal_evidence_invalid_history');
  rows.push({mechanism,setup_id:c.id,at,validation:'verified',legacy_grade:result.grade,target_history_start:evidence.bars.fourHour[0].timestamp});
 }
}
assert.equal(rows.length,67);assert.deepEqual(counts,previous.counts);
const files=['backend/src/utils/causal-plan-evidence.ts','backend/src/services/groq-dispatch.service.ts','docs/audits/2026-10-07-causal-evidence/registration.md'];
const hashes=Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({counts,checks,rows,hashes,scope:'shared plan revalidation; frozen legacy counts exactly reproduced; no grade replacement/workflow order/ROI proof',provider_calls:0},null,2),{flag:'wx'});
console.log(JSON.stringify({counts,checks}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});

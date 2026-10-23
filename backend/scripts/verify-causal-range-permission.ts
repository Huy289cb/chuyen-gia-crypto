import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(__dirname,'../..'),out=path.join(root,'docs/audits/2026-10-07-h2-permission-boundary');
const read=(p:string)=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
async function main(){
 Object.assign(process.env,read('docs/audits/2026-10-04-continuous-causal-portfolio/policy.json').environment,
  {CAUSAL_OPPORTUNITY_RESEARCH_ENABLED:'true',CAUSAL_SETUP_SCORING_VERSION:'rejection-volume-v1',CAUSAL_PERMISSION_VERSION:'existing-long-range-v1'});
 const {evaluateCausalRangePermission}=await import('../src/utils/causal-range-permission');
 const {sealCausalPlan}=await import('../src/utils/causal-plan-contract');
 const data=read('docs/audits/2026-09-11-opportunity-testbed/train-data.json');
 const duration={hour:3600000,five:300000,fifteen:900000,fourHour:14400000},tfs={hour:'1h',five:'5m',fifteen:'15m',fourHour:'4h'};
 const assessment=read('docs/audits/2026-10-07-h2-permission-boundary/assessment.json');
 const rows:any[]=[],checks:any[]=[];
 for(const row of read('docs/audits/2026-10-04-h2-feasibility/inventory.json').filter((r:any)=>r.window&&r.status==='plan')){
  const c=row.candidate,p=row.plan,at=row.resolvedAt,prior=assessment.rows.find((r:any)=>r.setup_id===c.id);
  const bars:any=Object.fromEntries(Object.entries(tfs).map(([key,tf])=>[key,data.byTf[tf].filter((b:number[])=>b[0]+duration[key as keyof typeof duration]+5000<=at).map((b:number[])=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}))]));
  const plan=sealCausalPlan({version:'h1-h2-review-v1',setupId:c.id,mechanism:'H2',symbol:'BTC',timeframe:'5m',side:c.side,knownAt:c.knownAt,expiresAt:c.expiresAt,entry:p.entry,stop:c.side==='long'?Math.floor(p.stop*10)/10:Math.ceil(p.stop*10)/10,target:p.target,invalidation:p.invalidation,minRr:1.5});
  const input={plan,evidence:{at,bars},now:at,htf1h:{fresh:true,regime:prior.actual_htf_regime},structure:bars.fourHour.slice(-120)};
  const result=await evaluateCausalRangePermission(input);rows.push({setup_id:c.id,result});
  if(!result.pass)continue;
  for(const [name,change]of Object.entries({stale_htf:{htf1h:{fresh:false,regime:'range'}},wrong_htf:{htf1h:{fresh:true,regime:'trend'}},missing_structure:{structure:[]},changed_geometry:{plan:sealCausalPlan({...plan,target:plan.target+1})}})){
   const denied=await evaluateCausalRangePermission({...input,...change});assert.equal(denied.pass,false,name);checks.push({name,reason:denied.reason});
  }
  process.env.CAUSAL_PERMISSION_VERSION='disabled';assert.equal((await evaluateCausalRangePermission(input)).pass,false);process.env.CAUSAL_PERMISSION_VERSION='existing-long-range-v1';checks.push({name:'activation_required'});
 }
 const accepted=rows.filter(r=>r.result.pass).map(r=>r.setup_id);assert.deepEqual(accepted,assessment.intersection);
 fs.writeFileSync(path.join(out,'bridge-verification.json'),JSON.stringify({accepted,rows,checks,provider_calls:0},null,2),{flag:'wx'});
 console.log(JSON.stringify({accepted,checks:checks.length}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});

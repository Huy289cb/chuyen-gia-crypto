'use strict';
// Read-only comparison to already-seen development inventories. Never a trading input.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
function assessInventory(inventory,expected,terminalStatus){
 const at=inventory.state.lastAt,events=inventory.events,windowStart=Date.parse('2025-02-01T00:00:05Z');
 const expectedPrefix=expected.filter(r=>r.window&&r.candidate.knownAt<=at);
 const observed=events.filter(e=>e.kind==='observed'&&e.row.candidate.knownAt>=windowStart),resolved=events.filter(e=>e.kind==='resolved'&&e.row.candidate.knownAt>=windowStart);
 const observedIds=observed.map(e=>e.row.candidate.id),resolvedIds=resolved.map(e=>e.row.candidate.id);
 const byId=new Map(resolved.map(e=>[e.row.candidate.id,e])),missing=[],unexpected=[],mismatches=[];
 const expectedIds=new Set(expectedPrefix.map(r=>r.candidate.id));
 for(const r of expectedPrefix){
  const id=r.candidate.id;if(!observedIds.includes(id))missing.push({id,stage:'observation'});
  if(r.resolvedAt<=at){const event=byId.get(id);if(!event)missing.push({id,stage:'resolution'});
   else try{assert.deepEqual({status:event.outcome.status,resolvedAt:event.at,plan:event.outcome},{status:r.status,resolvedAt:r.resolvedAt,plan:r.plan});}catch{mismatches.push(id);}}
 }
 for(const id of observedIds)if(!expectedIds.has(id))unexpected.push(id);
 const decisions=inventory.decisions.filter(d=>expectedIds.has(d.setup_id));
 const plans=resolved.filter(e=>e.outcome.status==='plan'),decisionIds=new Set(decisions.map(d=>d.setup_id));
 const undeliveredPlans=plans.filter(e=>!decisionIds.has(e.row.candidate.id)).map(e=>e.row.candidate.id);
 const reasons={};for(const d of decisions){const reason=d.result?.reason??d.reason??'unknown';reasons[reason]=(reasons[reason]??0)+1;}
 return {scope:terminalStatus?'terminal development inventory; not economic confirmation':'provisional running prefix; no gate promotion',terminal_status:terminalStatus??null,observed_through:at,
  expected_setups_in_observed_prefix:expectedPrefix.length,observed_setups:observed.length,resolved_setups:resolved.length,plans:plans.length,decisions:decisions.length,
  coverage_matches_prefix:!missing.length&&!unexpected.length&&!mismatches.length&&new Set(observedIds).size===observedIds.length&&new Set(resolvedIds).size===resolvedIds.length,
  missing,unexpected,mismatches,undelivered_plans:undeliveredPlans,decision_reasons:reasons,
  pending_admissions:decisions.filter(d=>d.result?.execution?.success).length,independent_fills:null,ROI_base:null,ROI_stress:null,
  limits:['Archived full-month development inventory used for coverage audit only, never engine input','Pending admission is not a fill','This assessment does not cover money/cost/journal atomicity or live parity']};
}
module.exports={assessInventory};
if(require.main===module){
 const [run,out,mode]=process.argv.slice(2);if(!run||!out||fs.existsSync(out))throw Error('RUN_DIR NEW_OUTPUT [interim]');
 const terminalFile=path.join(run,'result.json'),terminal=fs.existsSync(terminalFile)?JSON.parse(fs.readFileSync(terminalFile)):null;
 if(!terminal&&mode!=='interim')throw Error('terminal_result_required');
 const inventory=terminal?.causal_inventory??JSON.parse(fs.readFileSync(path.join(run,'causal-inventory.json')));
 const root=path.resolve(__dirname,'../..'),expected=['h1','h2'].flatMap(m=>JSON.parse(fs.readFileSync(path.join(root,`docs/audits/2026-10-04-${m}-feasibility/inventory.json`))));
 const report=assessInventory(inventory,expected,terminal?.status);fs.writeFileSync(out,JSON.stringify(report,null,2),{flag:'wx'});
 console.log(JSON.stringify({coverage_matches_prefix:report.coverage_matches_prefix,observed_setups:report.observed_setups,plans:report.plans,decisions:report.decisions}));
}

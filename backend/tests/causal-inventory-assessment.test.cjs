const {test}=require('node:test'),assert=require('node:assert/strict');
const {assessInventory}=require('../scripts/assess-causal-portfolio-inventory.cjs');
const start=Date.parse('2025-02-01T00:00:05Z');
const row={window:true,candidate:{id:'setup-a',knownAt:start+100},status:'expired',resolvedAt:start+200,plan:{status:'expired'}};
const observed={kind:'observed',at:start+100,row:{candidate:row.candidate}},resolved={kind:'resolved',at:start+200,row:{candidate:row.candidate},outcome:{status:'expired'}};
const inventory={state:{lastAt:start+300},events:[observed,resolved],decisions:[]};
test('missing or duplicate setups and modified terminal outcomes fail coverage',()=>{
 assert.equal(assessInventory(inventory,[row]).coverage_matches_prefix,true);
 for(const events of [[resolved],[observed],[observed,observed,resolved],[observed,{...resolved,outcome:{status:'plan',entry:100}}]]){
  assert.equal(assessInventory({...inventory,events},[row]).coverage_matches_prefix,false);
 }
});
test('future setups and future resolution do not become missing evidence in a running prefix',()=>{
 const before={...inventory,state:{lastAt:start+150},events:[observed]};
 const future={...row,candidate:{id:'future',knownAt:start+500}};
 const report=assessInventory(before,[row,future]);
 assert.equal(report.coverage_matches_prefix,true);assert.equal(report.expected_setups_in_observed_prefix,1);
 assert.equal(report.ROI_base,null);assert.equal(report.independent_fills,null);
});

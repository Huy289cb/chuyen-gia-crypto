import {describe,it,expect} from 'vitest';
import {opportunityFixture} from '../fixtures/ai-opportunity';
import {evaluateProspectivePair} from '../../src/backtest/prospective-pair-evaluation';
function fixture(){
 const f=opportunityFixture(),receivedAt=f.now+20000,first=Math.ceil(receivedAt/60000)*60000;
 const raw=JSON.stringify({decision:'wait',plan_id:null,reason_codes:['wait'],evidence_ids:['trend1h'],missing_confirmation:null});
 return {...f,first,input:{snapshotKey:'sample',snapshot:f.snapshot,capturedAt:f.now+1000,
  review:{snapshot:'sample',receivedAt,costUsd:.01,rawContent:raw},bars:[
   {timestamp:first,open:f.plan.entry,close:f.plan.entry,high:f.plan.takeProfit+1,low:f.plan.entry-1,volume:1}],
  funding:[],fundingCoveredThrough:first+60000,observedThrough:first+60000,slippageFraction:.001}};
}
describe('prospective matched comparison',()=>{
 it('charges AI wait while preserving all rejected-plan outcomes',()=>{
  const f=fixture(),r=evaluateProspectivePair(f.input);
  expect(r.paired).toBe(true);expect(r.allPlans).toHaveLength(f.snapshot.plans.length);
  expect(r.bNetUsd).toBeGreaterThan(0);expect(r.cAfterAiCostUsd).toBe(-.01);
  expect(r.deltaCMinusBUsd).toBeCloseTo(-.01-r.bNetUsd!);
 });
 it('subtracts inference cost even when both selectors take the identical plan',()=>{
  const f=fixture();f.input.review.rawContent=JSON.stringify({decision:'take',plan_id:f.plan.id,reason_codes:['take'],evidence_ids:['trend1h'],missing_confirmation:null});
  expect(evaluateProspectivePair(f.input).deltaCMinusBUsd).toBeCloseTo(-.01);
 });
 it('never treats unknown inference cost or censored outcomes as zero',()=>{
  const f=fixture();expect(evaluateProspectivePair({...f.input,review:{...f.input.review,costUsd:null}}).deltaCMinusBUsd).toBeNull();
  expect(evaluateProspectivePair({...f.input,bars:[]}).bNetUsd).toBeNull();
 });
 it('rejects stale, future, mislinked and missing responses',()=>{
  const f=fixture();
  expect(evaluateProspectivePair({...f.input,review:null}).reason).toBe('awaiting_response');
  expect(evaluateProspectivePair({...f.input,review:{...f.input.review,snapshot:'other'}}).paired).toBe(false);
  expect(evaluateProspectivePair({...f.input,review:{...f.input.review,receivedAt:f.now+120001}}).reason).toBe('stale_response');
  expect(evaluateProspectivePair({...f.input,observedThrough:f.now}).reason).toBe('future_response');
 });
 it('uses measured response time and refuses incomplete funding coverage',()=>{
  const f=fixture();const r=evaluateProspectivePair({...f.input,bars:[{...f.input.bars[0],timestamp:f.first-60000},...f.input.bars]});
  expect(r.allPlans[0].entryTime).toBe(f.first);
  expect(evaluateProspectivePair({...f.input,fundingCoveredThrough:f.first}).reason).toBe('incomplete_funding_coverage');
 });
});

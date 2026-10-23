import {describe,it,expect} from 'vitest';
import {buildProspectiveCohort,buildDirectionalRegimeCohort,PROSPECTIVE_UNION_VERSION} from '../../src/backtest/prospective-opportunity';
import {opportunityFixture} from '../fixtures/ai-opportunity';
describe('prospective paired opportunity cohort',()=>{
 it('preserves all eligible plans, separates baseline and fences the study from live',()=>{
  const f=opportunityFixture();f.candles['4h'][80].low=79750;
  const c=buildProspectiveCohort({...f,asOf:f.now})!;
  expect(c.snapshot.plans.some(p=>p.setup==='ema_retest_confirmed')).toBe(true);
  expect(c.snapshot.plans.some(p=>p.setup==='structure_reclaim_confirmed')).toBe(true);
  expect(c.snapshot.policyHash).not.toBe(f.policy.hash);
  expect(c.legacyBotDecision).toBeNull();expect(c.financialContext).toContain('paper');
  expect(new Set(c.snapshot.plans.map(p=>p.id)).size).toBe(c.snapshot.plans.length);
  expect(c.snapshot.plans.every(p=>p.evidenceIds.every(id=>c.snapshot.evidence.some(e=>e.id===id)))).toBe(true);
 });
 it('v2 retains a baseline plan excluded by an older opposing pivot, without rewriting v1',()=>{
  const f=opportunityFixture();
  // Old pivot is closer than the recent two and leaves insufficient RR for research targets.
  Object.assign(f.candles['4h'][80],{open:80500,close:80500,high:81000,low:80000});
  for(const i of [78,79,81,82])Object.assign(f.candles['4h'][i],{open:80300,close:80300,high:80400,low:80200});
  const input={...f,asOf:f.now};
  const v1=buildProspectiveCohort(input)!;
  const v2=buildProspectiveCohort(input,PROSPECTIVE_UNION_VERSION)!;
  expect(v1.referenceCurrentLibrary.plans.length).toBeGreaterThan(0);
  const missing=v1.referenceCurrentLibrary.plans.filter(p=>!v1.snapshot.plans.some(q=>q.id===p.id));
  expect(missing.length).toBeGreaterThan(0);
  for(const plan of v1.referenceCurrentLibrary.plans)expect(v2.snapshot.plans).toContainEqual(plan);
  expect(v2.snapshot.policyHash).not.toBe(v1.snapshot.policyHash);
  expect(v2.snapshot.plans.every(p=>p.evidenceIds.every(id=>v2.snapshot.evidence.some(e=>e.id===id)))).toBe(true);
  expect(buildProspectiveCohort(input)).toEqual(v1);
 });
 it('directional regime experiment preserves eligible bull plans but rejects transition',()=>{
  const f=opportunityFixture(),input={...f,asOf:f.now};
  const union=buildProspectiveCohort(input,PROSPECTIVE_UNION_VERSION)!;
  const directional=buildDirectionalRegimeCohort(input)!;
  expect(directional.snapshot.plans.length).toBeGreaterThan(0);
  expect(directional.snapshot.plans).toEqual(union.snapshot.plans);
  expect(directional.snapshot.policyHash).not.toBe(union.snapshot.policyHash);
  f.candles['4h'][97].low=75000;
  expect(buildProspectiveCohort(input,PROSPECTIVE_UNION_VERSION)!.snapshot.plans.length).toBeGreaterThan(0);
  expect(buildDirectionalRegimeCohort(input)!.snapshot.plans).toEqual([]);
  expect(buildDirectionalRegimeCohort(input)!.snapshot.deterministicPlanId).toBeNull();
  f.candles['4h'][96].high=89000;
  expect(buildDirectionalRegimeCohort(input)!.snapshot.plans.length).toBeGreaterThan(0);
  expect(buildDirectionalRegimeCohort(input)!.snapshot.plans).toEqual(buildProspectiveCohort(input,PROSPECTIVE_UNION_VERSION)!.snapshot.plans);
  f.candles['15m'][99].timestamp=f.now;
  expect(buildDirectionalRegimeCohort(input)).toBeNull();
 });
 it('rejects future candles and leaves valid empty snapshots available for coverage measurement',()=>{
  const f=opportunityFixture();f.candles['15m'][99].timestamp=f.now;
  expect(buildProspectiveCohort({...f,asOf:f.now})).toBeNull();
  const g=opportunityFixture();g.candles['15m'][99].close=79970;
  expect(buildProspectiveCohort({...g,asOf:g.now})?.snapshot.plans).toEqual([]);
 });
});

import {describe,it,expect} from 'vitest';
import {opportunityFixture} from '../fixtures/ai-opportunity';
import {buildResearchOpportunitySnapshot,buildOpportunitySnapshot} from '../../src/utils/ai-opportunity';
describe('offline structure reclaim hypothesis',()=>{
 it.each(['long','short'] as const)('requires an already-known pivot and later confirmation for %s',side=>{
  const f=opportunityFixture();f.candles['4h'][80].low=79750;
  if(side==='short')for(const rows of Object.values(f.candles))for(const b of rows){
   const high=b.high;b.open=160000-b.open;b.close=160000-b.close;b.high=160000-b.low;b.low=160000-high;
  }
  const s=buildResearchOpportunitySnapshot({...f,asOf:f.now},'structure_reclaim');
  expect(s?.plans[0]?.setup).toBe('structure_reclaim_confirmed');expect(s?.plans[0]?.side).toBe(side);
  expect(s?.policyHash).not.toBe(f.policy.hash);
  expect(buildOpportunitySnapshot({...f,asOf:f.now})?.plans.some(p=>p.setup==='structure_reclaim_confirmed')).toBe(false);
  f.candles['15m'][99].close=f.candles['15m'][98].close;
  expect(buildResearchOpportunitySnapshot({...f,asOf:f.now},'structure_reclaim')?.plans).toEqual([]);
 });
 it('does not call a pivot known before the sweep when it was only just confirmed',()=>{
  const f=opportunityFixture();
  // Pivot97 becomes confirmed by the latest4h bar99, after the sweep candle opened.
  f.candles['4h'][97].low=79750;
  expect(buildResearchOpportunitySnapshot({...f,asOf:f.now},'structure_reclaim')?.plans).toEqual([]);
 });
});

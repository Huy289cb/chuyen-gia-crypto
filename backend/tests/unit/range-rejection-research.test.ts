import {describe,it,expect} from 'vitest';
import {opportunityFixture} from '../fixtures/ai-opportunity';
import {buildResearchOpportunitySnapshot,buildOpportunitySnapshot} from '../../src/utils/ai-opportunity';
function fixture(){const f=opportunityFixture();f.candles['4h'][96].high=89000;f.candles['15m'][97].low=79000;return f;}
describe('range-edge rejection research',()=>{
 it.each(['long','short'] as const)('requires confirmed %s turn near the range edge',side=>{
  const f=fixture();if(side==='short')for(const rows of Object.values(f.candles))for(const b of rows){
   const high=b.high;b.open=160000-b.open;b.close=160000-b.close;b.high=160000-b.low;b.low=160000-high;
  }
  const s=buildResearchOpportunitySnapshot({...f,asOf:f.now},'range_rejection');
  expect(s?.plans[0]?.setup).toBe('range_rejection_confirmed');expect(s?.plans[0]?.side).toBe(side);
  expect(s?.policyHash).not.toBe(f.policy.hash);
  expect(buildOpportunitySnapshot({...f,asOf:f.now})?.plans.some(p=>p.setup==='range_rejection_confirmed')).toBe(false);
 });
 it('rejects midpoint and directional4h regime',()=>{
  const f=fixture();Object.assign(f.candles['15m'][99],{close:83000,high:83010});
  expect(buildResearchOpportunitySnapshot({...f,asOf:f.now},'range_rejection')?.plans).toEqual([]);
  const g=opportunityFixture();g.candles['15m'][97].low=79000;
  expect(buildResearchOpportunitySnapshot({...g,asOf:g.now},'range_rejection')?.plans).toEqual([]);
 });
 it('rejects a candle break without an intervening higher low',()=>{
  const f=fixture();f.candles['15m'][97].low=79960;
  expect(buildResearchOpportunitySnapshot({...f,asOf:f.now},'range_rejection')?.plans).toEqual([]);
 });
});

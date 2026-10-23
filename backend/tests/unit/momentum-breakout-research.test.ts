import {describe,it,expect} from 'vitest';
import {opportunityFixture} from '../fixtures/ai-opportunity';
import {buildResearchOpportunitySnapshot,buildOpportunitySnapshot} from '../../src/utils/ai-opportunity';
describe('research momentum breakout',()=>{
 it.each(['long','short'] as const)('requires closed breakout and volume for %s',side=>{
  const f=opportunityFixture();f.candles['15m'][99].volume=150;
  if(side==='short')for(const rows of Object.values(f.candles))for(const b of rows){
   const high=b.high;b.open=160000-b.open;b.close=160000-b.close;b.high=160000-b.low;b.low=160000-high;
  }
  const build=()=>buildResearchOpportunitySnapshot({...f,asOf:f.now},'momentum_breakout');
  expect(build()?.plans[0]?.setup).toBe('momentum_breakout_confirmed');
  expect(build()?.plans[0]?.side).toBe(side);expect(build()?.policyHash).not.toBe(f.policy.hash);
  expect(buildOpportunitySnapshot({...f,asOf:f.now})?.plans.some(p=>p.setup==='momentum_breakout_confirmed')).toBe(false);
  f.candles['15m'][99].volume=149.99;expect(build()?.plans).toEqual([]);
  f.candles['15m'][99].volume=150;f.candles['15m'][99].close=f.candles['15m'][98].close;
  expect(build()?.plans).toEqual([]);
 });
 it('rejects future candles and insufficient financial room',()=>{
  const f=opportunityFixture();f.candles['15m'][99].volume=200;
  f.finance.balance=1;
  expect(buildResearchOpportunitySnapshot({...f,asOf:f.now},'momentum_breakout')?.plans).toEqual([]);
  f.candles['15m'][99].timestamp=f.now;
  expect(buildResearchOpportunitySnapshot({...f,asOf:f.now},'momentum_breakout')).toBeNull();
 });
});

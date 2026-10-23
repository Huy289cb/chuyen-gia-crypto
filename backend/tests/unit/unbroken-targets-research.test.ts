import {describe,it,expect} from 'vitest';
import {opportunityFixture} from '../fixtures/ai-opportunity';
import {buildResearchOpportunitySnapshot} from '../../src/utils/ai-opportunity';
function fixture(){
 const f=opportunityFixture();
 for(let i=78;i<100;i++)Object.assign(f.candles['4h'][i],{open:80300,close:80300,high:80400,low:80200});
 f.candles['4h'][80].high=81000;
 f.candles['4h'][88].high=90000;f.candles['4h'][96].high=94000;
 f.candles['4h'][89].low=76000;f.candles['4h'][97].low=77000;
 return f;
}
describe('unbroken target research',()=>{
 it.each(['long','short'] as const)('removes a crossed pivot, retains wick-only crossing for %s',side=>{
  const f=fixture();
  f.candles['4h'][90].high=82000;
  if(side==='short')for(const rows of Object.values(f.candles))for(const b of rows){const high=b.high;
   b.open=160000-b.open;b.close=160000-b.close;b.high=160000-b.low;b.low=160000-high;}
  const build=(variant:'unbroken_targets'|'all_confirmed_120')=>buildResearchOpportunitySnapshot({...f,asOf:f.now},variant)!;
  expect(build('unbroken_targets').plans).toEqual([]);
  f.candles['4h'][90].close=side==='long'?81500:78500;
  // This also creates a nearer pivot at82000/78000; it too must be closed through.
  const last=f.candles['4h'][99];Object.assign(last,side==='long'?{open:83000,close:83000,high:83010,low:82990}:{open:77000,close:77000,high:77010,low:76990});
  expect(build('all_confirmed_120').plans).toEqual([]);
  expect(build('unbroken_targets').plans[0]?.side).toBe(side);
  expect(build('unbroken_targets').policyHash).not.toBe(f.policy.hash);
  f.candles['4h'][99].timestamp=f.now;
  expect(buildResearchOpportunitySnapshot({...f,asOf:f.now},'unbroken_targets')).toBeNull();
 });
});

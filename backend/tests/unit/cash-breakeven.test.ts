import {describe,it,expect} from 'vitest';
import {cashBreakevenSl,feeAwareBreakevenSl} from '../../src/utils/breakeven-sl';
import {computeProfitProtectSl} from '../../src/utils/profit-protect-sl';
describe('cash breakeven accounting',()=>{
 it.each(['long','short'] as const)('covers costs for %s while the old0.08%% buffer loses money',side=>{
  const input={side,entry:100000,quantity:.001,entryCostsUsd:.05,fundingPaidUsd:.01,exitFeeFraction:.0005,exitSlippageFraction:.001,tickSize:.1};
  const net=(exit:number)=>(side==='long'?1:-1)*(exit-input.entry)*input.quantity-input.entryCostsUsd-input.fundingPaidUsd-exit*input.quantity*.0005-.1;
  const fixed=feeAwareBreakevenSl(side,input.entry,.08),corrected=cashBreakevenSl(input)!;
  expect(net(fixed)).toBeLessThan(-.12);expect(net(corrected)).toBeGreaterThan(0);expect(net(corrected)).toBeLessThan(.001);
 });
 it('rejects incomplete/invalid cost inputs instead of treating unknown fees as zero',()=>{
  const input={side:'long' as const,entry:60000,quantity:.001,entryCostsUsd:.03,fundingPaidUsd:0,exitFeeFraction:.0005,exitSlippageFraction:.001,tickSize:.1};
  expect(cashBreakevenSl({...input,entryCostsUsd:NaN})).toBeNull();
  expect(cashBreakevenSl({...input,quantity:0})).toBeNull();
  expect(cashBreakevenSl({...input,tickSize:0})).toBeNull();
 });
 it('changes the BE price only, preserving2R activation and never loosening an existing stop',()=>{
  const input={side:'long' as const,entry:100000,mark:101599,currentSl:99200,initialRisk:800,ageMinutes:60,
   beAtR:2,trailActivatePct:2.5,trailDistancePct:.55,minSlMovePct:.05,minAgeMinutes:15,timeStopHours:0,beFeeBufferPct:.08,cashBreakevenSl:100210.3};
  expect(computeProfitProtectSl(input).action).toBe('none');
  expect(computeProfitProtectSl({...input,mark:101600})).toMatchObject({action:'breakeven',newSl:100210.3});
  expect(computeProfitProtectSl({...input,mark:101600,currentSl:100300}).action).toBe('none');
 });
});

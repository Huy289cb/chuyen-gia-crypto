import {it,expect} from 'vitest';
import {encodePostQuantityInput,replayRecordedPostQuantity} from '../../src/utils/recorded-post-quantity';
const input={side:'long' as const,entry:100,stopLoss:98,effectiveRiskUsd:1,effectiveRiskPercent:3,effectiveRiskCapUsd:1.5,expectedRr:2,minRr:2,invalidation:NaN,dailyEnabled:true,remainingDailyRiskUsd:1.2};
it('roundtrips actual decisions through JSON including known nonfinite RR and absent invalidation',()=>{
 const roundtrip=(value:typeof input)=>JSON.parse(JSON.stringify(encodePostQuantityInput(value)));
 expect(replayRecordedPostQuantity(roundtrip({...input,expectedRr:Infinity}))).toMatchObject({decision:{reason:'R:R Infinity below minimum 2'}});
 expect(replayRecordedPostQuantity(roundtrip(input))).toEqual({status:'evaluated',decision:{allowed:true}});
 expect(replayRecordedPostQuantity(roundtrip({...input,expectedRr:NaN}))).toMatchObject({status:'evaluated',decision:{allowed:false,rejectionCode:'rr'}});
});
it('does not infer missing flags, minimum RR or daily state from defaults',()=>{
 const recorded=encodePostQuantityInput(input);
 expect(replayRecordedPostQuantity({...recorded,dailyEnabled:undefined}).status).toBe('unknown');
 expect(replayRecordedPostQuantity({...recorded,minRr:null}).status).toBe('unknown');
 expect(replayRecordedPostQuantity({...recorded,remainingDailyRiskUsd:null}).status).toBe('unknown');
 expect(replayRecordedPostQuantity({})).toMatchObject({reason:'missing_post_quantity_schema'});
});

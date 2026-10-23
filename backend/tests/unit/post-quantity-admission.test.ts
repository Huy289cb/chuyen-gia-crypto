import {it,expect} from 'vitest';
import {evaluatePostQuantityAdmission,replayPostQuantityAdmission} from '../../src/utils/post-quantity-admission';
const input={side:'long' as const,entry:100,stopLoss:98,effectiveRiskUsd:1,effectiveRiskPercent:3,effectiveRiskCapUsd:1.5,expectedRr:2,minRr:2,invalidation:99,dailyEnabled:true,remainingDailyRiskUsd:1.2};
it('preserves ordered risk/RR/structural/daily gates and exact boundaries',()=>{
 expect(evaluatePostQuantityAdmission(input).allowed).toBe(true);
 expect(evaluatePostQuantityAdmission({...input,effectiveRiskUsd:2,expectedRr:1})).toMatchObject({rejectionCode:'risk_cap'});
 expect(evaluatePostQuantityAdmission({...input,expectedRr:1,remainingDailyRiskUsd:0})).toMatchObject({rejectionCode:'rr'});
 expect(evaluatePostQuantityAdmission({...input,stopLoss:99.5,remainingDailyRiskUsd:0})).toMatchObject({reason:'Stop must protect the structural invalidation level'});
 expect(evaluatePostQuantityAdmission({...input,remainingDailyRiskUsd:.9})).toMatchObject({rejectionCode:'daily_risk'});
 expect(evaluatePostQuantityAdmission({...input,remainingDailyRiskUsd:1,effectiveRiskCapUsd:1}).allowed).toBe(true);
});
it('replay refuses to silently equate missing daily state with legacy production admission',()=>{
 const missing={...input,remainingDailyRiskUsd:null};
 expect(evaluatePostQuantityAdmission(missing).allowed).toBe(true);
 expect(replayPostQuantityAdmission(missing).status).toBe('unknown');
 expect(replayPostQuantityAdmission(input)).toEqual({status:'evaluated',decision:evaluatePostQuantityAdmission(input)});
});

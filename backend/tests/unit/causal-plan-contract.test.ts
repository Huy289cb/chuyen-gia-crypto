import {it,expect} from 'vitest';
import {sealCausalPlan,causalPlanBlock,causalAnalysisBlock} from '../../src/utils/causal-plan-contract';
const plan=sealCausalPlan({version:'h1-h2-review-v1',setupId:'archived-h1',mechanism:'H1',symbol:'BTC',timeframe:'15m',side:'long',knownAt:100,expiresAt:1000,entry:100,stop:99,target:102,invalidation:99.5,minRr:1.5});
const approved={action:'buy',suggested_entry:100,suggested_stop_loss:99,suggested_take_profit:102,invalidation_level:99.5};
it('keeps exact plan geometry and veto semantics while rejecting rewritten or opposite approvals',()=>{
 expect(causalPlanBlock(plan,'BTC','15m',500)).toBeNull();
 expect(causalAnalysisBlock(plan,approved)).toBeNull();
 expect(causalAnalysisBlock(plan,{action:'hold'})).toBeNull();
 for(const change of [{action:'sell'},{suggested_entry:100.01},{suggested_stop_loss:98},{suggested_take_profit:103},{invalidation_level:99.4}]){
  expect(causalAnalysisBlock(plan,{...approved,...change})).toBe('causal_plan_review_changed');
 }
});
it('rejects altered hashes, future/expiry boundaries and resealed invalid identity or geometry',()=>{
 expect(causalPlanBlock({...plan,target:103},'BTC','15m',500)).toBe('causal_plan_identity_changed');
 expect(causalPlanBlock(plan,'BTC','15m',99)).toBe('causal_plan_expired_or_future');
 expect(causalPlanBlock(plan,'BTC','15m',1000)).toBe('causal_plan_expired_or_future');
 expect(causalPlanBlock(plan,'ETH','15m',500)).toBe('causal_plan_identity_changed');
 expect(causalPlanBlock(sealCausalPlan({...plan,timeframe:'5m'}),'BTC','5m',500)).toBe('causal_plan_identity_changed');
 expect(causalPlanBlock(sealCausalPlan({...plan,stop:101}),'BTC','15m',500)).toBe('causal_plan_geometry_invalid');
});

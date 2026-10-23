import {it,expect} from 'vitest';
import {buildResearchOpportunitySnapshot,opportunityPlanBlock,type OpportunityPlan} from '../../src/utils/ai-opportunity';
import {opportunityFixture} from '../fixtures/ai-opportunity';
function fixture(){
 const f=opportunityFixture();for(const b of f.candles['4h']){b.open=80500;b.close=80500;b.high=80505;b.low=80495;}
 f.candles['4h'][75].high=81000;f.candles['4h'][88].high=90000;f.candles['4h'][96].high=94000;return f;
}
it('observes rejected geometry without admitting it or changing the returned snapshot',()=>{
 const f=fixture(),rejected:{plan:OpportunityPlan;otherBlock:string|null}[]=[];
 const plain=buildResearchOpportunitySnapshot({...f,asOf:f.now});
 expect(buildResearchOpportunitySnapshot({...f,asOf:f.now},'all_confirmed_120',rejected)).toEqual(plain);
 expect(plain!.plans).toHaveLength(0);expect(rejected.length).toBeGreaterThan(0);
 const r=rejected[0];expect(r.plan.targetBound).toBe(81000);expect(r.plan.takeProfit).toBeGreaterThan(r.plan.targetBound);
 expect(r.otherBlock).toBeNull();expect(opportunityPlanBlock(r.plan,f.finance,f.policy,f.now)).toBe('structural_bounds');
});
it('exposes a second risk rejection instead of labeling it target-only',()=>{
 const f=fixture(),rejected:{plan:OpportunityPlan;otherBlock:string|null}[]=[];
 buildResearchOpportunitySnapshot({...f,asOf:f.now,finance:{...f.finance,balance:1}},'all_confirmed_120',rejected);
 expect(rejected.length).toBeGreaterThan(0);expect(rejected[0].otherBlock).toBe('risk_budget');
});

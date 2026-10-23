import { describe, it, expect } from 'vitest';
import { financialFeasibilityEnvelope, type EnvelopeInput } from '../../src/utils/financial-feasibility-envelope';
import { computeExecutionRisk } from '../../src/utils/execution-risk';
const base: EnvelopeInput = { entry:84340.3,balance:31.47744546,minSlFraction:.008,feePercent:.1,slippagePercent:.1,
  maxRiskPercent:3,maxRiskUsd:null,exposureUsd:100,remainingDailyRiskUsd:3,
  filters:{minQty:.001,maxQty:100,stepSize:.001,minNotional:50,tickSize:.1} };
describe('read-only financial envelope',()=>{
  it('uses the minimum exchange lot and production total risk, including short fee asymmetry',()=>{
    const r=financialFeasibilityEnvelope(base);expect(r.quantity).toBe(.001);
    expect(r.sides.every(s=>s.financiallyFeasibleAtFloor)).toBe(true);
    expect(r.sides[1].maxStopFraction).toBeLessThan(r.sides[0].maxStopFraction);
    for(const s of r.sides){
      const stop=s.widestStopWithinBudget!;
      const risk=(x:number)=>computeExecutionRisk({entry:base.entry,stopLoss:x,quantity:r.quantity,balance:base.balance,roundTripFeePercent:.1,slippagePercent:.1}).totalRiskUsd;
      expect(risk(stop)).toBeLessThanOrEqual(r.effectiveBudgetUsd+1e-9);
      expect(risk(stop+(s.side==='long'?-.1:.1))).toBeGreaterThan(r.effectiveBudgetUsd);
    }
  });
  it('accounts for minimum notional raising quantity and exposure independently',()=>{
    const r=financialFeasibilityEnvelope({...base,filters:{...base.filters,minNotional:100}});
    expect(r.quantity).toBe(.002);expect(r.sides[0].blockers).toContain('exposure');expect(r.sides[0].blockers).toContain('trade_risk');
  });
  it('reports unknown daily budget without pretending to authorize a trade',()=>{
    expect(financialFeasibilityEnvelope({...base,remainingDailyRiskUsd:null}).dailyBudgetKnown).toBe(false);
    expect(financialFeasibilityEnvelope({...base,remainingDailyRiskUsd:.5}).sides[0].blockers).toContain('daily_budget');
  });
  it('enforces floor after tick rounding at a tight risk boundary',()=>{
    const r=financialFeasibilityEnvelope({...base,maxRiskUsd:.843403});
    expect(r.sides[0].blockers).toContain('trade_risk');expect(r.sides[0].widestStopWithinBudget).toBeNull();
  });
  it('rejects missing filters, invalid exposure and NaN budgets',()=>{
    expect(()=>financialFeasibilityEnvelope({...base,filters:{...base.filters,tickSize:0}})).toThrow();
    expect(()=>financialFeasibilityEnvelope({...base,remainingDailyRiskUsd:NaN})).toThrow();
    expect(()=>financialFeasibilityEnvelope({...base,exposureUsd:-1})).toThrow();
  });
});

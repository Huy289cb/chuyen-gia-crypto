import {describe,it,expect} from 'vitest';
import {OpportunityPortfolio} from '../../src/backtest/opportunity-portfolio';
import type {AiOpportunityPolicy} from '../../src/config/ai-opportunity-policy';
import type {OpportunityPlan} from '../../src/utils/ai-opportunity';
describe('research ledger independently calculated cashflows',()=>{
 it.each(['long','short'] as const)('charges fees/slippage once and signs funding for %s',side=>{
  const policy={pinned:true,minRr:0,minSlFraction:.008,maxRiskPercent:3,maxRiskUsd:null,dailyPercent:10,targetPercent:.5,feePercent:.1,slippagePercent:.2,maxExposure:100}as AiOpportunityPolicy;
  const p=new OpportunityPortfolio(40,policy,{drawdownEnabled:false,maxDrawdownPercent:20,expectancyEnabled:false,expectancyWindow:10,expectancyMinSumR:-3,maxExposurePercentOfEquity:null},.0005,.002);
  const entry=60000,stopLoss=side==='long'?59520:60480,takeProfit=side==='long'?61200:58800;
  const plan={id:'cash',symbol:'BTC',side,timeframe:'15m',setup:'audit',entry,stopLoss,takeProfit,targetBound:takeProfit,quantity:.001,riskUsd:.48,rr:2.5,invalidation:stopLoss,expiresAt:7200000,evidenceIds:['cash']}as OpportunityPlan;
  p.advance(60000,entry);expect(p.reserve(plan,0)).toBeNull();p.advance(120000,entry);p.fill();expect(p.wallet).toBeCloseTo(39.91,10);
  p.advance(3600000,entry);p.fund(.0001,entry);p.advance(3660000,takeProfit);const result=p.close(takeProfit);
  const funding=side==='long'?.006:-.006,fee=.03+takeProfit*.001*.0005;
  expect(result.feesUsd).toBeCloseTo(fee,10);expect(result.slippageUsd).toBeCloseTo(.12,10);expect(result.fundingUsd).toBeCloseTo(funding,10);
  expect(result.netUsd).toBeCloseTo(1.2-fee-.12-funding,10);expect(p.wallet).toBeCloseTo(40+result.netUsd,10);expect(p.block()).toBe('cooldown');
 });
});

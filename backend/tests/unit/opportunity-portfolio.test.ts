import { describe,it,expect } from 'vitest';
import { opportunityFixture } from '../fixtures/ai-opportunity';
import { OpportunityPortfolio } from '../../src/backtest/opportunity-portfolio';
function setup() {
 const f=opportunityFixture();
 const ledger=new OpportunityPortfolio(100,f.policy,{maxDrawdownPercent:15,drawdownEnabled:true,expectancyEnabled:false,expectancyWindow:2,expectancyMinSumR:-2,maxExposurePercentOfEquity:null},.0005,.001);
 ledger.advance(f.now,f.plan.entry);return {...f,ledger};
}
describe('chronological opportunity portfolio',()=>{
 it('preserves initial cooldown, daily losses and expectancy without counting old PnL again',()=>{
  const f=setup(),seed={asOf:f.now,dayStartEquity:105,peakEquity:105,blockedUntil:f.now+3600000,
   openPositions:0 as const,pendingOrders:0 as const,recentCloses:[{time:f.now-1,netR:-3}]};
  const ledger=new OpportunityPortfolio(100,f.policy,{...f.ledger.circuit,expectancyEnabled:true,expectancyWindow:1},.0005,.001,seed);
  ledger.advance(f.now,f.plan.entry);
  expect(ledger.block()).toBe('cooldown');
  expect(ledger.finance(0).remainingDailyRiskUsd).toBeCloseTo(5.5);
  ledger.advance(f.now+3600000,f.plan.entry);expect(ledger.block()).toBe('expectancy_circuit');
  expect(ledger.closes).toHaveLength(0);expect(ledger.wallet).toBe(100);
  seed.recentCloses[0].netR=10;expect(ledger.block()).toBe('expectancy_circuit');
 });
 it('rejects future history instead of leaking outcomes into circuit state',()=>{
  const f=setup();expect(()=>new OpportunityPortfolio(100,f.policy,f.ledger.circuit,.0005,.001,
   {asOf:f.now,dayStartEquity:100,peakEquity:100,blockedUntil:0,openPositions:0,pendingOrders:0,
    recentCloses:[{time:f.now+1,netR:2}]})).toThrow('invalid_initial_portfolio_state');
 });
 it('enforces percent risk/exposure and reduces remaining daily risk after a loss',()=>{
  const f=setup();
  expect(f.ledger.reserve({...f.plan,quantity:.1},0)).toBe('risk_budget');
  f.ledger.circuit.maxExposurePercentOfEquity=50;
  expect(f.ledger.finance(0).remainingExposureUsd).toBe(50);
  expect(f.ledger.reserve(f.plan,0)).toBe('risk_budget');
  f.ledger.circuit.maxExposurePercentOfEquity=null;
  f.ledger.reserve(f.plan,0);f.ledger.fill();const c=f.ledger.close(f.plan.stopLoss);
  expect(f.ledger.finance(0).remainingDailyRiskUsd).toBeCloseTo(10+c.netUsd);
 });
 it('higher admission slippage rejects minimum-lot risk that passed the base estimate without raising the cap',()=>{
  const f=setup();
  const base=new OpportunityPortfolio(28,f.policy,f.ledger.circuit,.0005,.001);
  const stressedPolicy={...f.policy,slippagePercent:.2};
  const stressed=new OpportunityPortfolio(28,stressedPolicy,f.ledger.circuit,.0005,.001);
  base.advance(f.now,f.plan.entry);stressed.advance(f.now,f.plan.entry);
  expect(base.reserve(f.plan,0)).toBeNull();
  expect(stressed.reserve(f.plan,0)).toBe('risk_budget');
  expect(stressed.pending).toBeNull();
  expect(stressed.policy.maxRiskPercent).toBe(3);
  expect(f.policy.slippagePercent).toBe(.1);
 });
 it('reserves one order, charges entry costs at fill and locks quantity',()=>{
  const f=setup(),q=f.plan.quantity;
  expect(f.ledger.reserve(f.plan,.0001)).toBeNull();expect(f.ledger.reserve(f.plan,.0001)).toBe('occupied');
  f.plan.quantity=999;expect(f.ledger.pending?.quantity).toBe(q);
  expect(f.ledger.wallet).toBe(100);f.ledger.fill();expect(f.ledger.wallet).toBeCloseTo(100-f.plan.entry*q*.001);
 });
 it('posts funding when incurred and reconciles close PnL to cash',()=>{
  const f=setup();f.ledger.reserve(f.plan,0);f.ledger.fill();
  f.ledger.advance(f.now+60000,f.plan.entry);f.ledger.fund(.001,f.plan.entry);
  const afterFunding=f.ledger.wallet;expect(afterFunding).toBeLessThan(100);
  const close=f.ledger.close(f.plan.takeProfit);expect(f.ledger.wallet-100).toBeCloseTo(close.netUsd);
  expect(close.fundingUsd).toBeCloseTo(f.plan.entry*f.plan.quantity*.001);
 });
 it('blocks both sides for exactly one hour after close and cancel',()=>{
  const f=setup();f.ledger.reserve(f.plan,0);f.ledger.cancel();expect(f.ledger.block()).toBe('cooldown');
  f.ledger.advance(f.now+3599999,f.plan.entry);expect(f.ledger.block()).toBe('cooldown');
  f.ledger.advance(f.now+3600000,f.plan.entry);expect(f.ledger.block()).toBeNull();
  f.plan.expiresAt=f.now+7200000;f.ledger.reserve(f.plan,0);f.ledger.fill();f.ledger.close(f.plan.stopLoss);
  expect(f.ledger.block()).toBe('cooldown');
 });
 it('does not let intraday gains expand the day risk budget',()=>{
  const f=setup();f.ledger.reserve(f.plan,0);f.ledger.fill();f.ledger.close(f.plan.takeProfit);
  f.ledger.advance(f.now+1800000,f.plan.entry);expect(f.ledger.finance(0).remainingDailyRiskUsd).toBeCloseTo(10);
 });
 it('resets day-start equity at ICT midnight and uses unrealized equity',()=>{
  const f=setup();f.ledger.reserve(f.plan,0);f.ledger.fill();
  const midnight=Date.parse('2026-09-11T17:00:00Z');
  f.ledger.advance(midnight,f.plan.entry+100);expect(f.ledger.dayStart).toBeCloseTo(f.ledger.equity);
  expect(f.ledger.dayStart).toBeGreaterThan(f.ledger.wallet);
 });
 it('rejects time reversal and never clears expectancy just because cooldown ended',()=>{
  const f=setup();expect(()=>f.ledger.advance(f.now-1,f.plan.entry)).toThrow();
  f.ledger.circuit.expectancyEnabled=true;f.ledger.circuit.expectancyWindow=1;f.ledger.circuit.expectancyMinSumR=-.5;
  f.ledger.reserve(f.plan,0);f.ledger.fill();f.ledger.close(f.plan.stopLoss);
  f.ledger.advance(f.now+3600000,f.plan.entry);expect(f.ledger.block()).toBe('expectancy_circuit');
 });
});

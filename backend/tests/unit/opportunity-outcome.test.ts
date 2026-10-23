import { describe, expect, it } from 'vitest';
import { evaluateOpportunityOutcome } from '../../src/backtest/opportunity-outcome';
import { opportunityFixture } from '../fixtures/ai-opportunity';
const bar = (timestamp: number, open=100, high=101, low=99, close=100) => ({timestamp,open,high,low,close,volume:1});
function fixture() {
  const plan = {...opportunityFixture().plan, entry:100,stopLoss:90,takeProfit:130,quantity:1};
  const options = {submittedAt:0,entryExpiresAt:180000,horizonAt:300000,barMs:60000,feePerSide:.0005,slippageFraction:.001,funding:[]};
  return {plan,options};
}
describe('all-plan conservative outcome testbed', () => {
  it('cancels pending drift before a same-bar touch at the lifecycle tick', () => {
    const {plan,options}=fixture();
    const r=evaluateOpportunityOutcome(plan,[bar(0,110,111,99,100)],{...options,pendingReview:{cadenceMs:300000,maxDriftFraction:.008}});
    expect(r.status).toBe('unfilled');expect(r.reason).toBe('pending_drift_cancel');expect(r.entryTime).toBeNull();
    expect(()=>evaluateOpportunityOutcome(plan,[],{...options,pendingReview:{cadenceMs:1,maxDriftFraction:.008}})).toThrow('invalid_pending_review');
  });
  it('rejects malformed contracts, unsorted history and duplicate bars', () => {
    const {plan,options}=fixture();
    expect(()=>evaluateOpportunityOutcome({...plan,quantity:NaN},[],options)).toThrow('invalid_outcome_contract');
    expect(()=>evaluateOpportunityOutcome(plan,[bar(0),bar(0)],options)).toThrow('invalid_bar_order');
    expect(()=>evaluateOpportunityOutcome(plan,[bar(60000),bar(0)],options)).toThrow('invalid_bar_order');
    expect(()=>evaluateOpportunityOutcome(plan,[],{...options,funding:[{time:1,rate:NaN,markPrice:100}]})).toThrow('invalid_funding');
  });
  it('does not change a completed result when later future bars are added', () => {
    const {plan,options}=fixture();
    const prefix=[bar(0),bar(60000,100,131,99,130)];
    expect(evaluateOpportunityOutcome(plan,[...prefix,bar(120000,100,140,50,100)],options))
      .toEqual(evaluateOpportunityOutcome(plan,prefix,options));
  });
  it('accounts for both fees, slippage and signed funding', () => {
    const {plan,options}=fixture();
    const r=evaluateOpportunityOutcome(plan,[bar(0),bar(60000,100,131,99,130)],{...options,funding:[{time:60000,rate:.001,markPrice:100}]});
    expect(r.status).toBe('closed'); expect(r.grossUsd).toBe(30);
    expect(r.feesUsd).toBeCloseTo(.115); expect(r.slippageUsd).toBe(.1); expect(r.fundingUsd).toBe(.1);
    expect(r.netUsd).toBeCloseTo(29.685);
  });
  it('charges an adverse stop gap at open, not the requested SL', () => {
    const {plan,options}=fixture();
    const r=evaluateOpportunityOutcome(plan,[bar(0),bar(60000,80,85,75,81)],options);
    expect(r.exitPrice).toBe(80); expect(r.reason).toBe('gap_stop');
  });
  it('does not award TP before an intrabar entry', () => {
    const {plan,options}=fixture();
    const r=evaluateOpportunityOutcome(plan,[bar(0,110,135,99,101)],options);
    expect(r.status).toBe('censored'); expect(r.netUsd).toBeNull(); expect(r.ambiguous).toBe(true);
  });
  it('uses stop-first for ambiguous long and short paths', () => {
    const {plan,options}=fixture();
    for(const p of [plan,{...plan,side:'short' as const,stopLoss:110,takeProfit:70}]) {
      const r=evaluateOpportunityOutcome(p,[bar(0,100,140,60,100)],options);
      expect(r.exitPrice).toBe(p.stopLoss); expect(r.ambiguous).toBe(true); expect(r.netUsd).toBeLessThan(0);
    }
  });
  it('does not use a partial submission candle', () => {
    const {plan,options}=fixture();
    const r=evaluateOpportunityOutcome(plan,[bar(0,100,140,60,100),bar(60000,110,111,109,110)],{...options,submittedAt:10000});
    expect(r.entryTime).toBeNull(); expect(r.status).toBe('censored');
  });
  it('distinguishes unfilled expiry from missing data and partial expiry', () => {
    const {plan,options}=fixture();
    const bars=[0,60000,120000,180000].map(t=>bar(t,110,111,109,110));
    expect(evaluateOpportunityOutcome(plan,bars,options).status).toBe('unfilled');
    expect(evaluateOpportunityOutcome(plan,[bars[0],bars[2]],options).reason).toBe('data_gap');
    expect(evaluateOpportunityOutcome(plan,bars,{...options,entryExpiresAt:170000}).reason).toBe('partial_expiry_bar');
  });
  it('marks an open trade at the specified horizon only with complete data', () => {
    const {plan,options}=fixture();
    const bars=[0,60000,120000,180000,240000].map(t=>bar(t));
    expect(evaluateOpportunityOutcome(plan,bars,options).reason).toBe('time_exit');
    expect(evaluateOpportunityOutcome(plan,bars.slice(0,-1),options).netUsd).toBeNull();
  });
});

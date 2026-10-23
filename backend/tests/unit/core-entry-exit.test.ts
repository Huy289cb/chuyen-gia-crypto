import {describe,it,expect} from 'vitest';
import {confirmedCoreRetests,costCoveredStop} from '../../src/backtest/core-entry-exit';
import {replayCoreCandidates,type CoreReplayInput} from '../../src/backtest/core-ablation-replay';
import type {AiOpportunityPolicy} from '../../src/config/ai-opportunity-policy';
const bar=(timestamp:number,open:number,high:number,low:number,close:number)=>({timestamp,open,high,low,close,volume:1});
describe('confirmed retest',()=>{
 const candidate={id:'a',time:900000,timeframe:'15m',side:'long' as const,setup:'breakout',entry:60000,stopLoss:59520,takeProfit:61440,targetBound:61440};
 const byTf={'15m':[bar(0,59800,60010,59750,60000)],'5m':[bar(900000,59880,59960,59870,59950)]};
 it('waits for closed confirmation and uses its close, never its low as entry',()=>{
  const r=confirmedCoreRetests([candidate],byTf).accepted[0];
  expect(r.time).toBe(1200000);expect(r.entry).toBe(59950);expect(r.stopLoss).toBeLessThanOrEqual(59950*.992);
  expect(confirmedCoreRetests([candidate],{...byTf,'5m':[]}).accepted).toHaveLength(0);
  expect(confirmedCoreRetests([candidate],{...byTf,'5m':[...byTf['5m'],bar(1200000,59950,62000,59000,61000)]}).accepted).toEqual([r]);
 });
 it('rejects a target or stop consumed before confirmation',()=>{
  expect(confirmedCoreRetests([candidate],{...byTf,'5m':[bar(900000,59880,61500,59870,59950)]}).rejected[0].reason).toBe('target_consumed');
  expect(confirmedCoreRetests([candidate],{...byTf,'5m':[bar(900000,59880,60000,59500,59950)]}).rejected[0].reason).toBe('stop_invalidated');
 });
});
describe('cost-covered protection',()=>{
 it('covers accrued funding, fees and modeled slip for both sides',()=>{
  for(const side of ['long','short'] as const){
   const input={side,entry:60000,quantity:.001,entryFee:.03,entrySlip:.06,funding:.01,feePerSide:.0005,roundTripSlippage:.002};
   const price=costCoveredStop(input),d=side==='long'?1:-1;
   const net=d*(price-input.entry)*input.quantity-input.entryFee-input.entrySlip-input.funding-price*input.quantity*.0005-.06;
   expect(net).toBeGreaterThan(0);expect(net).toBeLessThan(.001);
  }
 });
 it('does not apply a newly confirmed protective stop retroactively within its trigger bar',()=>{
  const start=86400000;
  const bars=Array.from({length:8},(_,i)=>[start+i*60000,60000,60020,59990,60000,1]);
  bars[4]=[start+240000,60000,60600,59990,60500,1];
  bars[5]=[start+300000,60500,60520,60000,60050,1];
  const input:CoreReplayInput={bars,start,end:start+480000,wallet:40,
   funding:[{time:start-3600000,rate:0,markPrice:60000}],slippage:.002,
   policy:{pinned:true,minRr:0,minSlFraction:.008,maxRiskPercent:3,maxRiskUsd:null,dailyPercent:10,targetPercent:.5,feePercent:.1,slippagePercent:.2,maxExposure:100,ttlMs:3600000} as AiOpportunityPolicy,
   circuit:{drawdownEnabled:false,maxDrawdownPercent:20,expectancyEnabled:false,expectancyWindow:20,expectancyMinSumR:0,maxExposurePercentOfEquity:null},
   candidates:[{id:'a',time:start+60000,timeframe:'5m',side:'long',setup:'test',entry:60000,stopLoss:59520,takeProfit:61440,targetBound:61440}],exitPolicy:'cost_protection_1r'};
  const r=replayCoreCandidates(input);
  expect(r.events.find(e=>e.type==='protect_stop')?.time).toBe(start+300000);
  expect(r.closes[0].time).toBe(start+360000);expect(r.closes[0].reason).toBe('cost_protection_stop');
  expect(r.closes[0].netUsd).toBeGreaterThan(0);
  expect(replayCoreCandidates({...input,exitPolicy:undefined}).closes[0].reason).toBe('end_liquidation');
 });
});

import {describe,it,expect} from 'vitest';
import {coreClosed,coreLevels,nearestCoreTarget} from '../../src/backtest/core-ablation';
import {replayCoreCandidates,validateCoreMinutes,compareCoreCohorts,type CoreReplayInput} from '../../src/backtest/core-ablation-replay';
import type {AiOpportunityPolicy} from '../../src/config/ai-opportunity-policy';
const bar=(timestamp:number,close=100)=>({timestamp,open:close,high:close+1,low:close-1,close,volume:1});
const policy={pinned:true,minRr:0,minSlFraction:.008,maxRiskPercent:3,maxRiskUsd:null,dailyPercent:10,targetPercent:.5,
 feePercent:.1,slippagePercent:.2,maxExposure:100,ttlMs:3600000} as AiOpportunityPolicy;
function fixture():CoreReplayInput{
 const start=86400000,end=start+12*60000;
 const bars=Array.from({length:12},(_,i)=>[start+i*60000,60000,60020,59990,60000,1]);
 return {bars,start,end,funding:[{time:start-3600000,rate:0,markPrice:60000}],wallet:40,policy,slippage:.001,
 circuit:{drawdownEnabled:false,maxDrawdownPercent:20,expectancyEnabled:false,expectancyWindow:20,expectancyMinSumR:0,maxExposurePercentOfEquity:null},
 candidates:[{id:'a',time:start+60000,timeframe:'5m',side:'long',setup:'test',entry:60000,stopLoss:59520,takeProfit:61440,targetBound:61440}]};
}
describe('core ablation causality and structural levels',()=>{
 it('never includes an open HTF bar or future candles',()=>{
  const rows=[bar(0),bar(3600000),bar(7200000)];
  expect(coreClosed(rows,3600000,'1h')).toEqual(rows.slice(0,1));
  expect(coreClosed(rows,3600000,'1h')).toEqual(coreClosed(rows.slice(0,1),3600000,'1h'));
 });
 it('does not manufacture a structural target to reach RR3',()=>{
  const levels=coreLevels('long',60000,3,.008,60300,59000,true)!;
  expect(levels.takeProfit).toBe(60300);expect(levels.stopLoss).toBeLessThan(59000);
  expect(coreLevels('long',60000,3,.008,null,59000,true)).toBeNull();
 });
 it('consumes a confirmed liquidity target after a wick touch',()=>{
  const rows=[100,102,110,103,102].map((n,i)=>bar(i*3600000,n));
  expect(nearestCoreTarget(rows,'long',105)).toBe(111);
  expect(nearestCoreTarget([...rows,{...bar(5*3600000,105),high:111}],'long',105)).toBeNull();
 });
});
describe('shared core execution ledger',()=>{
 it('rejects missing minute coverage',()=>{
  const f=fixture();expect(()=>validateCoreMinutes(f.bars.slice(1),f.start,f.end)).toThrow();
 });
 it('does not fill on the signal candle or latency minute',()=>{
  const f=fixture();f.bars[0][3]=59000;f.bars[1][3]=59000;
  const r=replayCoreCandidates(f),fill=r.events.find(e=>e.type==='fill')!;
  expect(fill.time).toBe(f.start+120000);
  expect(r.closes[0].reason).toBe('end_liquidation');
 });
 it('uses adverse stop-first ordering and preserves one-hour post-close cooldown',()=>{
  const f=fixture();f.bars[2][2]=62000;f.bars[2][3]=59000;
  f.candidates.push({...f.candidates[0],id:'b',time:f.start+240000});
  const r=replayCoreCandidates(f);
  expect(r.summary.trades).toBe(1);expect(r.closes[0].reason).toBe('ambiguous_stop_first');
  expect(r.summary.blocks.cooldown).toBe(1);expect(r.closes[0].netUsd).toBeLessThan(-.48);
 });
 it('fills a resting limit that gaps through SL and charges the gap loss',()=>{
  const f=fixture();f.bars[2]=[f.start+120000,59000,59100,58900,59000,1];
  const r=replayCoreCandidates(f);
  expect(r.summary.trades).toBe(1);expect(r.closes[0].reason).toBe('gap_stop');
  expect(r.closes[0].netUsd).toBeLessThan(-1);
 });
 it('charges actual funding once and reconciles costs with final liquidation',()=>{
  const f=fixture();f.funding.push({time:f.start+300000,rate:.0001,markPrice:60000});
  const r=replayCoreCandidates(f);
  expect(r.summary.funding).toBeCloseTo(.006,10);
  expect(r.summary.netUsd).toBeCloseTo(-r.summary.fees-r.summary.slippage-r.summary.funding,10);
 });
 it('blocks minimum-lot plans exceeding the 3% owner cap',()=>{
  const f=fixture();f.wallet=10;const r=replayCoreCandidates(f);
  expect(r.summary.fills).toBe(0);expect(r.summary.blocks.risk_budget).toBe(1);
 });
 it('accounts for added, removed and changed common trades',()=>{
  const f=fixture(),a=replayCoreCandidates(f).closes[0];
  const r=compareCoreCohorts([a,{...a,planId:'removed',netUsd:-1}],[{...a,netUsd:2},{...a,planId:'added',netUsd:3}]);
  expect(r.delta).toBeCloseTo(r.addedNet-r.removedNet+r.commonDelta);expect(r.added).toBe(1);expect(r.removed).toBe(1);
 });
});

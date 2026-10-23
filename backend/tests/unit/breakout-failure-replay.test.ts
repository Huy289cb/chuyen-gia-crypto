import {describe,it,expect} from 'vitest';
import {replayCoreCandidates,type CoreReplayInput} from '../../src/backtest/breakout-failure-replay';
import type {AiOpportunityPolicy} from '../../src/config/ai-opportunity-policy';
function fixture():CoreReplayInput{
 const start=86400000;return {start,end:start+60*60000,wallet:40,slippage:.002,
 bars:Array.from({length:60},(_,i)=>{const p=i>=16?59800:60000;return[start+i*60000,p,p+10,p-10,p,1];}),funding:[{time:start-3600000,rate:0,markPrice:60000}],
 policy:{pinned:true,minRr:0,minSlFraction:.008,maxRiskPercent:3,maxRiskUsd:null,dailyPercent:10,targetPercent:.5,feePercent:.1,slippagePercent:.2,maxExposure:100}as AiOpportunityPolicy,
 circuit:{drawdownEnabled:false,maxDrawdownPercent:20,expectancyEnabled:false,expectancyWindow:10,expectancyMinSumR:-3,maxExposurePercentOfEquity:null},
 candidates:[{id:'failure',time:start+60000,timeframe:'15m',side:'long',setup:'breakout',entry:60000,stopLoss:59520,takeProfit:60960,targetBound:60960}],failedBreakoutExit:true};
}
describe('failed breakout exit without future fills',()=>{
 it('requires two whole post-entry bars and exits at next minute open',()=>{const f=fixture(),r=replayCoreCandidates(f);expect(r.closes[0].reason).toBe('failed_breakout');expect(r.closes[0].time).toBe(f.start+45*60000);expect(r.closes[0].netUsd).toBeCloseTo(-.2-.0599-.12,8);});
 it('resets consecutive count when a15m candle reclaims the boundary',()=>{const f=fixture();f.bars[44]=[f.start+44*60000,60000,60010,59990,60000,1];expect(replayCoreCandidates(f).closes[0].reason).toBe('end_liquidation');});
 it('charges adverse next-open gap instead of assuming signal-close execution',()=>{const f=fixture();f.bars[45]=[f.start+45*60000,59000,59100,58900,59000,1];const c=replayCoreCandidates(f).closes[0];expect(c.reason).toBe('failed_breakout');expect(c.netUsd).toBeCloseTo(-1-.0595-.12,8);});
});

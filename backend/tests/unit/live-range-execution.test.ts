import {describe,it,expect,vi,afterEach} from 'vitest';
import {replayCoreCandidates,type CoreReplayInput} from '../../src/backtest/live-range-execution-replay';
import type {AiOpportunityPolicy} from '../../src/config/ai-opportunity-policy';
function fixture():CoreReplayInput{const start=86400000,end=start+60*60000;return {start,end,bars:Array.from({length:60},(_,i)=>[start+i*60000,60100,60110,60090,60100,1]),funding:[{time:start-3600000,rate:0,markPrice:60000}],wallet:40,slippage:.001,policy:{pinned:true,minRr:0,minSlFraction:.008,maxRiskPercent:3,maxRiskUsd:null,dailyPercent:10,targetPercent:.5,feePercent:.1,slippagePercent:.2,maxExposure:100}as AiOpportunityPolicy,circuit:{drawdownEnabled:false,maxDrawdownPercent:20,expectancyEnabled:false,expectancyWindow:10,expectancyMinSumR:-3,maxExposurePercentOfEquity:null},candidates:[{id:'a',time:start+60000,timeframe:'5m',side:'long',setup:'range',entry:60000,stopLoss:59520,takeProfit:60720,targetBound:60720}]};}
afterEach(()=>vi.unstubAllEnvs());
describe('live-config execution bridge',()=>{
 it('uses supplied exchange filters for both sizing and reservation',()=>{
  const f=fixture();f.terminalPolicy='retain_open';
  f.end=f.start+10*60000;f.bars=f.bars.slice(0,10);
  f.quantityFilters={stepSize:.0001,minQty:.0001,minNotional:5};
  const r=replayCoreCandidates(f);
  expect(r.summary.submitted).toBe(1);
  expect(r.terminal.pending?.quantity).toBe(.0004);
  expect(r.summary.quantityFilterSource).toBe('supplied_filters');
  expect(replayCoreCandidates({...f,quantityFilters:undefined}).terminal.pending?.quantity).toBe(.001);
 });
 it('rejects unavailable filters and minimum lots above exposure instead of inventing fills',()=>{
  const f=fixture();f.quantityFilters={stepSize:NaN,minQty:.001,minNotional:50};
  expect(()=>replayCoreCandidates(f)).toThrow('invalid_quantity_filters');
  f.quantityFilters={stepSize:.002,minQty:.002,minNotional:50};
  const r=replayCoreCandidates(f);
  expect(r.summary.submitted).toBe(0);expect(r.summary.fills).toBe(0);
  expect(r.summary.blocks.quantity_exposure).toBe(1);
 });
 it('retains open positions without manufacturing a close or dropping entry costs',()=>{
  const f=fixture();f.bars[3][3]=59990;f.terminalPolicy='retain_open';
  const r=replayCoreCandidates(f);
  expect(r.summary.fills).toBe(1);expect(r.closes).toHaveLength(0);
  expect(r.summary.unfinished).toBe(true);expect(r.terminal.holding).not.toBeNull();
  expect(r.summary.cashChangeUsd).toBeCloseTo(-.06);
  expect(r.summary.markedEquityChangeUsd).toBeCloseTo(.04);
  expect(r.events.some(e=>e.type==='close')).toBe(false);
 });
 it('does not erase a resting exchange fill when funding flips after submission',()=>{
  const f=fixture();f.funding.push({time:f.start+120000,rate:.001,markPrice:60000});
  f.bars[3][3]=59990;
  const r=replayCoreCandidates(f);expect(r.summary.submitted).toBe(1);expect(r.summary.fills).toBe(1);
  expect(r.summary.blocks.fill_funding).toBeUndefined();
 });
 it('honors pre-existing cooldown in the actual entry replay runner',()=>{
  const f=fixture();f.bars[3][3]=59990;
  expect(replayCoreCandidates(f).summary.fills).toBe(1);
  f.initialState={asOf:f.start,dayStartEquity:40,peakEquity:40,blockedUntil:f.end,
   openPositions:0,pendingOrders:0,recentCloses:[]};
  const r=replayCoreCandidates(f);expect(r.summary.fills).toBe(0);expect(r.summary.blocks.cooldown).toBe(1);
  expect(r.summary.initialStateSource).toBe('supplied_flat_snapshot');
  f.initialState.asOf--;expect(()=>replayCoreCandidates(f)).toThrow('initial_state_must_match_replay_start');
 });
 it('allows a touch before45m expiry but rejects one after it',()=>{vi.stubEnv('PENDING_ORDER_TTL_HOURS_5M','.75');const before=fixture(),after=fixture();before.bars[45][3]=59990;after.bars[47][3]=59990;expect(replayCoreCandidates(before).summary.fills).toBe(1);const r=replayCoreCandidates(after);expect(r.summary.fills).toBe(0);expect(r.summary.expired).toBe(1);});
 it('cancels a still-unfilled order when price drifts0.8%',()=>{vi.stubEnv('PENDING_ORDER_DRIFT_PCT','.008');const f=fixture();f.bars[3]=[f.start+180000,60500,60510,60490,60500,1];const r=replayCoreCandidates(f);expect(r.summary.fills).toBe(0);expect(r.summary.blocks.pending_drift_cancel).toBe(1);});
 it('does not retroactively drift-cancel a resting fill gapping through its stop',()=>{const f=fixture();f.bars[3]=[f.start+180000,59000,59100,58900,59000,1];const r=replayCoreCandidates(f);expect(r.summary.fills).toBe(1);expect(r.closes[0].reason).toBe('gap_stop');expect(r.summary.netUsd).toBeLessThan(-1);});
});

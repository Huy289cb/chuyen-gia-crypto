import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {evaluatePreAiEntryGates} from '../../src/utils/pre-ai-entry-gates';
describe('pre-AI gates preserve established exceptions',()=>{
 beforeEach(()=>{
  vi.stubEnv('V3_REQUIRE_HTF_TREND','1h');vi.stubEnv('V3_HTF_TREND_ALT','15m');
  vi.stubEnv('V3_BREAKOUT_REGIME_BYPASS','true');vi.stubEnv('MIN_SIGNAL_GRADE','B');
  vi.stubEnv('V3_HTF_FLEX_LTF_ONLY','true');vi.stubEnv('V3_BLOCK_RANGE_ENTRIES','true');
 });
 afterEach(()=>vi.unstubAllEnvs());
 const base={optimizedRangeRetest:false,timeframe:'15m',gateRegime:'trend',grade:'A',confidence:.9,
  playbookKey:'breakout_volume',playbookSide:'long' as const,scanState:()=>({fresh:true,regime:'range'})};
 it('keeps the grade-A long breakout bypass, but not for shorts',()=>{
  expect(evaluatePreAiEntryGates(base).pass).toBe(true);
  expect(evaluatePreAiEntryGates({...base,playbookSide:'short'})).toMatchObject({pass:false,gate:'htf'});
 });
 it('allows the LTF alternate trend without granting that exception to H1 entries',()=>{
  const input={...base,playbookKey:'liquidity_sweep',scanState:(tf:string)=>({fresh:true,regime:tf==='15m'?'trend':'range'})};
  expect(evaluatePreAiEntryGates(input).pass).toBe(true);
  expect(evaluatePreAiEntryGates({...input,timeframe:'1h'}).pass).toBe(false);
 });
 it('rejects missing primary data even if alternate data is trend',()=>{
  const result=evaluatePreAiEntryGates({...base,playbookKey:'liquidity_sweep',scanState:(tf:string)=>({fresh:tf==='15m',regime:'trend',reason:'stale primary'})});
  expect(result).toMatchObject({pass:false,gate:'htf',reason:'stale primary'});
 });
 it('preserves dedicated range retest admission, which validates separately',()=>{
  expect(evaluatePreAiEntryGates({...base,optimizedRangeRetest:true,gateRegime:'range'}).pass).toBe(true);
  expect(evaluatePreAiEntryGates({...base,gateRegime:'range'})).toMatchObject({pass:false,gate:'regime'});
 });
});

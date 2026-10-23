import {describe,it,expect} from 'vitest';
import {volatilityScaledRegime} from '../../src/backtest/volatility-scaled-regime';
import {SignalGateService} from '../../src/services/signal-gate.service';
import {analyzeSetupGate} from '../../src/analyzers/setup-gate.analyzer';
const bars=(zigzag=false)=>Array.from({length:80},(_,i)=>{const close=100+i*.1+(zigzag?(i%2?2:-2):0);return {timestamp:i*300000,open:close-.05,high:close+.1,low:close-.1,close,volume:100};});
describe('volatility scaled regime research',()=>{
 it('recognizes orderly movement and rejects a high-noise path',()=>{
  expect(volatilityScaledRegime(bars(),'5m').regime).toBe('trend');
  expect(volatilityScaledRegime(bars(true),'5m').regime).toBe('range');
 });
 it('is invariant to price units and preserves direction',()=>{
  const a=volatilityScaledRegime(bars(),'5m');
  const b=volatilityScaledRegime(bars().map(c=>({...c,open:c.open*100,high:c.high*100,low:c.low*100,close:c.close*100})),'5m');
  expect(b.regime).toBe(a.regime);expect(b.trendDirection).toBe(a.trendDirection);
 });
 it('requires isolated caching for research evaluation',()=>{
  expect(()=>new SignalGateService({},input=>volatilityScaledRegime(input.candles,input.timeframe))).toThrow('isolated_cache');
 });
 it('keeps the default analyzer path byte-identical when no research model is passed',async()=>{
  const input={candles:bars(),symbol:'BTC',timeframe:'5m'};
  expect(await analyzeSetupGate(input)).toEqual(await analyzeSetupGate(input,undefined));
  const a=new SignalGateService({enableDuplicateFilter:false});
  const result=await a.evaluate(input);expect(result.setupResult).toEqual(await analyzeSetupGate(input));
 });
});

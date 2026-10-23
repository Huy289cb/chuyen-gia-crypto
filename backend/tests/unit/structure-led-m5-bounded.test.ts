import {describe,it,expect} from 'vitest';
import {boundCoreCandidates,boundStructureLedM5} from '../../src/backtest/structure-led-m5-bounded';
import type {BacktestCandle} from '../../src/backtest/types';
import type {CoreCandidate} from '../../src/backtest/core-ablation';
const b=(t:number,p:number):BacktestCandle=>({timestamp:t,open:p,close:p,high:p+10,low:p-10,volume:1});
describe('structure-led M5 bounded geometry',()=>{
 it('uses the actual source timeframe for invalidation and preserves a wider structural stop',()=>{
  const time=6*3600000;
  const byTf={'5m':Array.from({length:6},(_,i)=>b(time-1800000+i*300000,60000)),
   '15m':Array.from({length:6},(_,i)=>b(time-5400000+i*900000,59000)),
   '1h':[59900,60000,60400,60100,60000].map((p,i)=>b(i*3600000,p)),'4h':[]};
  const c:CoreCandidate={id:'x',time,timeframe:'15m',side:'long',setup:'sweep',entry:60000,stopLoss:59520,takeProfit:61440,targetBound:61440};
  const result=boundCoreCandidates([c],byTf,.004).accepted[0];
  expect(result.stopLoss).toBeLessThan(58990);
  expect(result.takeProfit).toBe(60410);
  expect(()=>boundStructureLedM5([c],byTf,.004)).toThrow('expected_m5_candidates');
  expect(boundCoreCandidates([c],{...byTf,'15m':[...byTf['15m'],b(time,50000)]},.004).accepted[0]).toEqual(result);
 });
 it('caps TP at an existing barrier and ignores future target consumption',()=>{
  const time=6*3600000;
  const byTf={'5m':Array.from({length:6},(_,i)=>b(time-1800000+i*300000,60000)),
   '1h':[59900,60000,60400,60100,60000].map((p,i)=>b(i*3600000,p)),'4h':[]};
  const c:CoreCandidate={id:'x',time,timeframe:'5m',side:'long',setup:'sweep',entry:60000,stopLoss:59520,takeProfit:61440,targetBound:61440};
  const r=boundStructureLedM5([c],byTf,.008);
  expect(r.accepted[0].takeProfit).toBe(60410);
  const future={...byTf,'1h':[...byTf['1h'],b(time,62000)]};
  expect(boundStructureLedM5([c],future,.008)).toEqual(r);
 });
 it('rejects missing structural targets',()=>{
  expect(boundStructureLedM5([{id:'x',time:1,side:'long',timeframe:'5m',setup:'x',entry:100,stopLoss:99,takeProfit:103,targetBound:103}],{'5m':[],'1h':[],'4h':[]},.008).accepted).toHaveLength(0);
 });
});

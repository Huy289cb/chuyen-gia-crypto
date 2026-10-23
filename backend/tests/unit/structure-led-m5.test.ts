import {describe,it,expect} from 'vitest';
import {selectStructureLedM5} from '../../src/backtest/structure-led-m5';
import type {CoreCandidate} from '../../src/backtest/core-ablation';
const c=(id:string,time=100):CoreCandidate=>({id,time,timeframe:'5m',side:'long',setup:'test',entry:60000,stopLoss:59520,takeProfit:61440,targetBound:61440});
describe('structure-led M5 experiment selection',()=>{
 it('selects pre-execution gate differences, without consulting trade results',()=>{
  expect(selectStructureLedM5([c('common')],[c('new'),c('common')])).toEqual([c('new')]);
 });
 it('fails closed when the comparator is not a pure gate relaxation',()=>{
  expect(()=>selectStructureLedM5([c('common')],[{...c('common'),entry:61000}])).toThrow();
  expect(()=>selectStructureLedM5([c('common')],[])).toThrow();
  expect(()=>selectStructureLedM5([],[{...c('bad'),timeframe:'15m'}])).toThrow();
 });
 it('rejects duplicate keys instead of double-counting opportunities',()=>{
  expect(()=>selectStructureLedM5([],[c('x'),c('x')])).toThrow();
 });
});

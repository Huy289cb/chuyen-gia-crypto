import {describe,it,expect} from 'vitest';
import {hasRangeTargetRoom} from '../../src/utils/range-target-room';
describe('structural room for range targets',()=>{
 it('accepts a target inside the box and rejects targets requiring a breakout',()=>{
  const box={side:'long' as const,entry:80000,rangeLow:79500,rangeHigh:81200};
  expect(hasRangeTargetRoom({...box,target:81000})).toBe(true);
  expect(hasRangeTargetRoom({...box,target:81200})).toBe(true);
  expect(hasRangeTargetRoom({...box,target:81200.1})).toBe(false);
 });
 it('mirrors the rule for shorts',()=>{
  const box={side:'short' as const,entry:81000,rangeLow:79800,rangeHigh:82000};
  expect(hasRangeTargetRoom({...box,target:79800})).toBe(true);
  expect(hasRangeTargetRoom({...box,target:79799})).toBe(false);
 });
 it('fails closed for absent or invalid structural levels and nonprofitable targets',()=>{
  const x={side:'long' as const,entry:80000,target:81000,rangeLow:79000,rangeHigh:82000};
  expect(hasRangeTargetRoom({...x,rangeHigh:undefined})).toBe(false);
  expect(hasRangeTargetRoom({...x,rangeLow:null})).toBe(false);
  expect(hasRangeTargetRoom({...x,target:79900})).toBe(false);
 });
});

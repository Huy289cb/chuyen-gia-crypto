import { describe,it,expect } from 'vitest';
import { detectRangeEdgeRejection,rangeEdgeLevels } from '../../src/utils/range-edge-rejection';
const c=(open:number,high:number,low:number,close:number,timestamp=0)=>({open,high,low,close,timestamp,volume:1});
const hourly=Array.from({length:25},(_,i)=>c(101,103,100,101,i*3600000));
describe('range edge research setup',()=>{
 it('detects a confirmed lower-edge rejection without needing a new low',()=>{
  const setup=detectRangeEdgeRejection({hourly,local:[c(100.3,100.5,100.1,100.3),c(100.3,100.55,100.2,100.5)],hourlyRegime:'range',macroBias:'transition'});
  expect(setup?.side).toBe('long');expect(setup?.structuralStop).toBeCloseTo(99.85);expect(setup?.target).toBeCloseTo(102.4);
  const levels=rangeEdgeLevels(setup!,100.5);expect(levels!.stopLoss).toBeCloseTo(99.696);expect(levels!.takeProfit).toBeCloseTo(102.4);
 });
 it('blocks long against bearish macro structure and blocks trend regimes',()=>{
  const input={hourly,local:[c(100.3,100.5,100.1,100.3),c(100.3,100.55,100.2,100.5)],hourlyRegime:'range',macroBias:'bear' as const};
  expect(detectRangeEdgeRejection(input)).toBeNull();expect(detectRangeEdgeRejection({...input,macroBias:'bull',hourlyRegime:'trend'})).toBeNull();
 });
 it('mirrors rejection at the upper edge',()=>{
  const setup=detectRangeEdgeRejection({hourly,local:[c(102.8,102.9,102.6,102.7),c(102.7,102.8,102.4,102.5)],hourlyRegime:'range',macroBias:'bear'});
  expect(setup?.side).toBe('short');expect(rangeEdgeLevels(setup!,102.5)?.takeProfit).toBeCloseTo(100.6);
 });
 it('rejects chasing a gap beyond the zone and insufficient reward room',()=>{
  const setup={side:'long' as const,rangeLow:100,rangeHigh:103,structuralStop:99.85,target:102.4,entryZoneLimit:100.6};
  expect(rangeEdgeLevels(setup,100.8)).toBeNull();expect(rangeEdgeLevels({...setup,target:101},100.5)).toBeNull();
 });
});

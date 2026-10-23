import {describe,it,expect} from 'vitest';
import {formatSetupNumber} from '../../src/utils/setup-number-format';
describe('cached setup price formatting',()=>{
 it('preserves original locale output including non-finite and rounded values',()=>{
  for(const n of [0,-0,1.005,-1234.56789,60000.125,NaN,Infinity,-Infinity])for(const d of [0,1,2,4,8]){
   expect(formatSetupNumber(n,d)).toBe(n.toLocaleString('en-US',{maximumFractionDigits:d}));
  }
 });
});

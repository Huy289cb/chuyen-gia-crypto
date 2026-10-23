import { describe, it, expect } from 'vitest';
import { reconstructExchangeRounds } from '../../src/utils/exchange-rounds';
import { selectCloseExchangeRound as select } from '../../src/utils/close-round-match';
const rounds=reconstructExchangeRounds([
 {tradeId:1,orderId:'entry',side:'BUY',price:100,qty:1,commission:.1,commissionAsset:'USDT',realizedPnl:0,time:1000},
 {tradeId:2,orderId:'exit',side:'SELL',price:110,qty:1,commission:.1,commissionAsset:'USDT',realizedPnl:10,time:2000},
]);
describe('shared close round identity selection',()=>{
 it('anchors an exact complete entry round and preserves side aliases',()=>{
  expect(select(rounds,'buy','entry',1)).toBe(rounds[0]);expect(select(rounds,'long','entry',-1)).toBe(rounds[0]);
 });
 it('rejects a closing order mistaken for entry, wrong side/qty and ambiguous matches',()=>{
  expect(select(rounds,'long','exit',1)).toBeNull();expect(select(rounds,'short','entry',1)).toBeNull();
  expect(select(rounds,'long','entry',2)).toBeNull();expect(select([...rounds,...rounds],'long','entry',1)).toBeNull();
 });
});
it('accepts partial reduction only with single-entry and final-order quantity lineage',()=>{
 const r=reconstructExchangeRounds([{tradeId:1,orderId:'entry',side:'BUY',price:100,qty:1,commission:.1,realizedPnl:0,time:1000},{tradeId:2,orderId:'partial',side:'SELL',price:110,qty:.5,commission:.05,realizedPnl:5,time:2000},{tradeId:3,orderId:'final',side:'SELL',price:120,qty:.5,commission:.05,realizedPnl:10,time:3000}]);
 expect(select(r,'long','entry',.5)).toBeNull();expect(select(r,'long','entry',.5,true)).toBe(r[0]);expect(select(r,'long','entry',.4,true)).toBeNull();expect(select([...r,...r],'long','entry',.5,true)).toBeNull();
 const mixed=structuredClone(r);mixed[0].fills[0].orderId='other';expect(select(mixed,'long','entry',.5,true)).toBeNull();
 const interleaved=structuredClone(r);interleaved[0].fills[1].time=4000;expect(select(interleaved,'long','entry',.5,true)).toBeNull();
});

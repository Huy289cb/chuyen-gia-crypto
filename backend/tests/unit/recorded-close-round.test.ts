import { describe,it,expect } from 'vitest';
import { replayRecordedCloseRound as replay } from '../../src/utils/recorded-close-round';
const now=Date.parse('2026-10-02T12:50:00Z');
const fills=[{tradeId:1,orderId:'entry',side:'BUY',price:100,qty:1,commission:.1,commissionAsset:'USDT',realizedPnl:0,time:now-2000},
 {tradeId:2,orderId:'exit',side:'SELL',price:110,qty:1,commission:.2,commissionAsset:'USDT',realizedPnl:10,time:now-1000}];
const income=[{tranId:3,incomeType:'FUNDING_FEE',income:'0.5',asset:'USDT',time:now-1500}];
const data={schema:'close-round-query-v1',input:{symbol:'BTCUSDT',side:'long',entry_order_id:'entry',size_qty:1,window_start:now-3000,window_end:now-500},
 observations:{source:'binance_window_queries',fills_complete:true,income_complete:true,received_at:new Date(now).toISOString(),fills,income}};
describe('recorded exchange round economics',()=>{
 it('uses exchange pnl and signed funding without subtracting fees twice or calling it total ROI',()=>{
  const result=replay(JSON.parse(JSON.stringify(data)),now,now);expect(result.status).toBe('evaluated');if(result.status==='evaluated'){
   expect(result.exchange_net_pnl).toBeCloseTo(10.2);expect(result.round.fundingFee).toBe(-.5);expect(result.economic_total_pnl).toBeNull();}
 });
 it('requires explicit complete query and priced raw rows',()=>{
  for(const observations of [{...data.observations,income_complete:false},{...data.observations,fills:[{...fills[0],commissionAsset:undefined},fills[1]]},
   {...data.observations,fills:[...fills,fills[0]]},{...data.observations,income:[...income,income[0]]},{...data.observations,income:[{...income[0],income:'0x10'}]},
   {...data.observations,fills:[{...fills[0],tradeId:{}},fills[1]]}])expect(replay({...data,observations},now,now).status).toBe('unknown');
 });
 it('rejects future, wrong anchor/qty and incomplete closing inventory',()=>{
  expect(replay(data,now,now-1).status).toBe('unknown');
  for(const input of [{...data.input,entry_order_id:'exit'},{...data.input,size_qty:2}])expect(replay({...data,input},now,now).status).toBe('unknown');
  expect(replay({...data,observations:{...data.observations,fills:[fills[0]]}},now,now).status).toBe('unknown');
 });
});
it('replays explicit partial-reduction lineage while old records remain conservative',()=>{
 const partialFills=[fills[0],{...fills[1],tradeId:2,orderId:'partial',qty:.5,commission:.1,realizedPnl:5,time:now-1500},{...fills[1],tradeId:3,orderId:'final',qty:.5,commission:.1,realizedPnl:5,time:now-1000}];
 const record={...data,input:{...data.input,size_qty:.5},observations:{...data.observations,fills:partialFills}};
 expect(replay(record,now,now).status).toBe('unknown');const r=replay({...record,input:{...record.input,partial_reduction:true}},now,now);expect(r.status).toBe('evaluated');if(r.status==='evaluated')expect(r.exchange_net_pnl).toBeCloseTo(10.2);
});

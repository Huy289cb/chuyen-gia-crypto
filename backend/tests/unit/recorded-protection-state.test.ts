import { describe, it, expect } from 'vitest';
import { replayRecordedProtectionState as replay } from '../../src/utils/recorded-protection-state';
const now = Date.parse('2026-10-02T12:30:00Z');
const clocks = { started_at: new Date(now-2000).toISOString(), received_at: new Date(now-1000).toISOString() };
const row = {symbol:'BTCUSDT',positionSide:'BOTH',positionAmt:'0',entryPrice:'0',markPrice:'100'};
const data = {schema:'protection-state-observation-v1',symbol:'BTCUSDT',known_at:new Date(now).toISOString(),
  positions:{status:'observed',endpoint:'/fapi/v2/positionRisk',...clocks,rows:[row]},
  orders:{status:'observed',endpoint:'/fapi/v1/openAlgoOrders',...clocks,rows:[]}};
describe('raw protection state query replay', () => {
  it('observes flat at query time without inferring fills or concurrent coverage', () => {
    const result = replay(JSON.parse(JSON.stringify(data)),now);
    expect(result.status).toBe('observed'); if(result.status==='observed'){
      expect(result.flat_at_position_query).toBe(true);expect(result.open_positions).toEqual([]);expect(result.concurrent_protection).toBe('not_established');
    }
  });
  it.each([[],[row,row],[{...row,positionAmt:' '}],[{...row,positionAmt:'NaN'}],[{...row,positionAmt:'0.000000001',entryPrice:'100'}],
    [{...row,positionSide:'LONG',positionAmt:'-1',entryPrice:'100'}],[row,{...row,positionSide:'LONG'}]].map(rows=>({rows})))('does not fabricate a valid position state from $rows', ({rows})=>{
    expect(replay({...data,positions:{...data.positions,rows}},now).status).toBe('unknown');
  });
  it('uses shared signed position normalization and legacy ID matching with explicit limits', () => {
    const result = replay({...data,positions:{...data.positions,rows:[{...row,positionAmt:'-0.001',entryPrice:'100'}]},orders:{...data.orders,
      rows:[{symbol:'BTCUSDT',side:'BUY',positionSide:'BOTH',orderType:'STOP_MARKET',algoId:'12'}]}},now);
    expect(result.status).toBe('observed');if(result.status==='observed'){
      expect(result.open_positions[0].side).toBe('short');expect(result.open_positions[0].positionAmt).toBe(.001);
      expect(result.orders.status).toBe('observed');if(result.orders.status==='observed')expect(result.orders.legacy_matching_ids[0].stopLossId).toBe('12');
      expect(result.concurrent_protection).toBe('not_established');
    }
  });
  it('retains position evidence when orders fail or are duplicated without calling coverage valid', () => {
    const order = {symbol:'BTCUSDT',algoId:12};
    for(const orders of [{...data.orders,status:'unknown'}, {...data.orders,rows:[order,order]}]){
      const result=replay({...data,orders},now);expect(result.status).toBe('observed');if(result.status==='observed')expect(result.orders.status).toBe('unknown');
    }
  });
  it('requires persistence knowledge and ordered query clocks', () => {
    expect(replay(data,now-1).status).toBe('unknown');
    expect(replay({...data,positions:{...data.positions,received_at:new Date(now+1).toISOString()}},now).status).toBe('unknown');
    expect(replay(data,NaN).status).toBe('unknown');
  });
});

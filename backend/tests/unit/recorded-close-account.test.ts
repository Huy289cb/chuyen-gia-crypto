import { describe, it, expect } from 'vitest';
import { buildCloseAccountUpdate } from '../../src/utils/close-account-update';
import { replayRecordedCloseAccount as replay } from '../../src/utils/recorded-close-account';
const now=Date.parse('2026-10-02T12:45:00Z');
const record=(pnl=-1)=>JSON.parse(JSON.stringify({schema:'close-account-update-v1',account_id:1,
  input:{balance:30,realized_pnl:pnl,bookkeeping:false,fill_verified:true,binance_enabled:true,last_trade_time:new Date(now-2000).toISOString(),updated_at:new Date(now-1000).toISOString()},
  update:buildCloseAccountUpdate({balance:30,realizedPnl:pnl,lastTradeTime:new Date(now-2000),updatedAt:new Date(now-1000)}),applied_at:new Date(now).toISOString()}));
describe('recorded successful account write',()=>{
 it('distinguishes DB-return timestamps from legacy asynchronous telemetry clocks',()=>{
  const legacy=replay(record(),now,now); expect(legacy.status==='evaluated' && legacy.application_ordering).toBe('not_established');
  const data={...record(),applied_clock_source:'db_update_return'};
  const result=replay(data,now,now); expect(result.status==='evaluated' && result.application_ordering).toBe('db_return_observed');
  expect(replay({...data,applied_clock_source:'callback_time'},now,now)).toEqual({status:'unknown',reason:'invalid_applied_clock_source'});
 });
 it('replays exact loss and threshold writes without asserting a complete ledger',()=>{
  for(const pnl of [-1,-.01,0,.01,1]){const result=replay(record(pnl),now,now);expect(result.status).toBe('evaluated');if(result.status==='evaluated'){expect(result.matches_recorded).toBe(true);expect(result.ledger_completeness).toBe('not_established');}}
 });
 it('detects changed and unexpected write fields independently of JSON key order',()=>{
  const data=record(); data.update.current_balance=28;const result=replay(data,now,now);expect(result.status).toBe('evaluated');if(result.status==='evaluated')expect(result.matches_recorded).toBe(false);
  const extra=record();extra.update.unrecorded=1;const added=replay(extra,now,now);if(added.status==='evaluated')expect(added.matches_recorded).toBe(false);else throw Error('expected evaluated');
 });
 it('rejects missing/nonfinite input, future data, clocks and ineligible writes',()=>{
  expect(replay(record(),now,now-1).status).toBe('unknown');
  for(const balance of [null,NaN,'30']){const data=record();data.input.balance=balance;expect(replay(data,now,now).status).toBe('unknown');}
  const clock=record();clock.applied_at=new Date(now+1).toISOString();expect(replay(clock,now,now).status).toBe('unknown');
  const ineligible=record();ineligible.input.fill_verified=false;expect(replay(ineligible,now,now)).toEqual({status:'mismatch',reason:'ineligible_account_write'});
 });
});
it('replays wallet authority explicitly and rejects mismatched balance projections',()=>{
 const d=record(1);d.input.wallet_authoritative=true;delete d.update.current_balance;delete d.update.equity;
 expect(replay(d,now,now)).toMatchObject({status:'evaluated',matches_recorded:true});
 d.update.current_balance=31;expect(replay(d,now,now)).toMatchObject({status:'evaluated',matches_recorded:false});delete d.update.current_balance;d.input.binance_enabled=false;expect(replay(d,now,now).status).toBe('unknown');
});

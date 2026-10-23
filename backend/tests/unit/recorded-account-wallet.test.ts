import {describe,it,expect} from 'vitest';
import {replayAccountWalletJournal as replay} from '../../src/utils/recorded-account-wallet';
const now=Date.parse('2026-10-02T13:30:00Z');
const event=()=>({id:1,event_type:'account_wallet_sync_observed',timestamp:new Date(now).toISOString(),event_data:{schema:'wallet-sync-v1',sync_attempt_id:'00000000-0000-4000-8000-000000000001',account_id:2,status:'applied',source:'normalized_account_api',requested_at:new Date(now-300).toISOString(),received_at:new Date(now-200).toISOString(),applied_at:new Date(now-100).toISOString(),snapshot:{walletBalance:30,equity:31,unrealizedPnl:1},update:{current_balance:30,equity:31,unrealized_pnl:1,updated_at:new Date(now-150).toISOString()}}});
describe('account-level wallet cutoff',()=>{
 it('ignores position copies and retains absolute overwrites without PnL inference',()=>{
  const e=event(),r=replay([e,{...e,id:2,event_type:'wallet_sync_observed'}],now);expect(r.rows).toHaveLength(1);expect(r.ignoredPositionCopies).toBe(1);expect(r.rows[0]).toMatchObject({status:'evaluated',account_id:2,matches_recorded:true,balance_operation:'absolute_overwrite',economic_total_pnl:null});
 });
 it('rejects duplicate attempts and excludes future copies before ambiguity checks',()=>{
  const e=event();expect(replay([e,{...e,id:2}],now).rows.every(r=>r.status==='unknown')).toBe(true);
  const r=replay([e,{...e,id:2,timestamp:new Date(now+1).toISOString()}],now);expect(r.excludedFuture).toBe(1);expect(r.rows[0].status).toBe('evaluated');
 });
 it('retains missing identity, query failure and changed-write uncertainty',()=>{
  const e=event();e.event_data.sync_attempt_id='';expect(replay([e],now).rows[0]).toMatchObject({status:'unknown',reason:'missing_sync_attempt_identity'});
  const failure=event();failure.event_data.status='query_failed';expect(replay([failure],now).rows[0].status).toBe('unknown');
  const changed=event();changed.event_data.update.current_balance=99;expect(replay([changed],now).rows[0]).toMatchObject({status:'evaluated',matches_recorded:false});
 });
});

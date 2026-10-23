import {describe,it,expect} from 'vitest';
import {replayCloseLedgerJournal as replay} from '../../src/utils/recorded-close-ledger';
import {buildCloseAccountUpdate} from '../../src/utils/close-account-update';
import {buildWalletSyncUpdate} from '../../src/utils/wallet-sync-update';
const now=Date.parse('2026-10-02T13:00:00Z');
const query={id:1,position_id:'p1',timestamp:new Date(now).toISOString(),event_type:'close_round_query_observed',event_data:{schema:'close-round-query-v1',
 input:{symbol:'BTCUSDT',side:'long',entry_order_id:'entry',size_qty:1,window_start:now-5000,window_end:now-2000},observations:{source:'binance_window_queries',fills_complete:true,income_complete:true,received_at:new Date(now-2000).toISOString(),income:[],
 fills:[{tradeId:1,orderId:'entry',side:'BUY',price:100,qty:1,commission:.1,commissionAsset:'USDT',realizedPnl:0,time:now-4000},{tradeId:2,orderId:'exit',side:'SELL',price:110,qty:1,commission:.2,commissionAsset:'USDT',realizedPnl:10,time:now-3000}]}}};
const pnl=10-.1-.2;
const write={id:2,position_id:'p1',timestamp:new Date(now-500).toISOString(),event_type:'close_account_update_applied',event_data:JSON.parse(JSON.stringify({schema:'close-account-update-v1',account_id:1,
 input:{balance:30,realized_pnl:pnl,bookkeeping:false,fill_verified:true,binance_enabled:true,last_trade_time:new Date(now-1500).toISOString(),updated_at:new Date(now-1000).toISOString()},
 update:buildCloseAccountUpdate({balance:30,realizedPnl:pnl,lastTradeTime:new Date(now-1500),updatedAt:new Date(now-1000)}),applied_at:new Date(now-900).toISOString()}))};
describe('causal close ledger association',()=>{
 it('associates a later absolute wallet overwrite without adding wallet balance to round PnL',()=>{
  const tagged=JSON.parse(JSON.stringify(write));tagged.event_data.applied_clock_source='db_update_return';
  const snapshot={walletBalance:41,equity:42,unrealizedPnl:1};
  const wallet={id:3,position_id:'p1',timestamp:new Date(now).toISOString(),event_type:'wallet_sync_observed',event_data:JSON.parse(JSON.stringify({
   schema:'wallet-sync-v1',account_id:1,status:'applied',source:'normalized_account_api',snapshot,
   requested_at:new Date(now-800).toISOString(),received_at:new Date(now-700).toISOString(),applied_at:new Date(now-600).toISOString(),
   update:buildWalletSyncUpdate(snapshot,new Date(now-650))}))};
  const association=(events:Parameters<typeof replay>[0])=>{const row=replay(events,now).rows[0];if(row.status!=='associated')throw Error('expected close association');return row;};
  const row=association([query,tagged,wallet]);expect(row.exchange_net_pnl).toBe(pnl);expect(row.economic_total_pnl).toBeNull();
  expect(row.wallet_association).toMatchObject({status:'associated',matches_recorded:true,balance_operation:'absolute_overwrite',additional_realized_pnl:null});
  expect(association([query,write,wallet]).wallet_association).toEqual({status:'unknown',reason:'account_application_order_unknown'});
  expect(association([query,tagged,wallet,{...wallet,id:4}]).wallet_association).toEqual({status:'unknown',reason:'missing_or_ambiguous_wallet_write'});
  const wrong=JSON.parse(JSON.stringify(wallet));wrong.event_data.account_id=2;
  expect(association([query,tagged,wrong]).wallet_association).toEqual({status:'unknown',reason:'wallet_account_mismatch'});
  const early=JSON.parse(JSON.stringify(wallet));early.event_data.requested_at=new Date(now-950).toISOString();
  expect(association([query,tagged,early]).wallet_association).toEqual({status:'unknown',reason:'wallet_query_precedes_account_application'});
  const future={...wallet,timestamp:new Date(now+1).toISOString()};
  expect(association([query,tagged,future]).wallet_association).toEqual({status:'unknown',reason:'missing_or_ambiguous_wallet_write'});
  const changed=JSON.parse(JSON.stringify(wallet));changed.event_data.update.current_balance=99;
  expect(association([query,tagged,changed]).wallet_association).toMatchObject({status:'associated',matches_recorded:false});
 });
 it('matches observed clocks even if async query journal persists after account journal',()=>{
  const result=replay([write,query],now);expect(result.rows[0].status).toBe('associated');if(result.rows[0].status==='associated'){expect(result.rows[0].matches_recorded).toBe(true);expect(result.rows[0].economic_total_pnl).toBeNull();}
 });
 it('does not use future evidence to repair missing past component or count retries twice',()=>{
  expect(replay([query,write],now-1).rows[0].status).toBe('unknown');
  expect(replay([query,write,{...query,id:3}],now).rows[0].status).toBe('unknown');
  expect(replay([query,write,{...query}],now).rows[0].status).toBe('unknown');
 });
 it('rejects a real account update clock preceding the query receipt',()=>{
  const later=JSON.parse(JSON.stringify(query));later.event_data.observations.received_at=new Date(now-500).toISOString();
  expect(replay([later,write],now).rows[0]).toEqual({position_id:'p1',status:'unknown',reason:'account_update_precedes_query_receipt'});
 });
 it('detects pnl inconsistency and retains missing position evidence',()=>{
  const changed=JSON.parse(JSON.stringify(write));changed.event_data.input.realized_pnl=8;changed.event_data.update=JSON.parse(JSON.stringify(buildCloseAccountUpdate({balance:30,realizedPnl:8,lastTradeTime:new Date(now-1500),updatedAt:new Date(now-1000)})));
  const result=replay([query,changed],now);expect(result.rows[0].status).toBe('associated');if(result.rows[0].status==='associated'){expect(result.rows[0].account.matches_recorded).toBe(true);expect(result.rows[0].matches_recorded).toBe(false);}
  expect(replay([{...query,position_id:undefined}],now).unknown[0].reason).toBe('missing_position_association');
 });
});

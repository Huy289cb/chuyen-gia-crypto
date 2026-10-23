import {it,expect} from 'vitest';
import {replayAccountOverwriteTimeline as replay} from '../../src/utils/recorded-account-timeline';
const now=Date.parse('2026-10-02T13:45:00Z');
const event=(id:number,start:number,end:number)=>({id,event_type:'account_wallet_sync_observed',timestamp:new Date(now).toISOString(),event_data:{schema:'wallet-sync-v1',sync_attempt_id:`00000000-0000-4000-8000-${String(id).padStart(12,'0')}`,account_id:1,status:'applied',source:'normalized_account_api',requested_at:new Date(start-2).toISOString(),received_at:new Date(start-1).toISOString(),applied_at:new Date(end).toISOString(),snapshot:{walletBalance:30+id,equity:30+id,unrealizedPnl:0},update:{current_balance:30+id,equity:30+id,unrealized_pnl:0,updated_at:new Date(start).toISOString()}}});
it('orders observed writes independently of persistence sequence without claiming current state',()=>{
 const r=replay([event(2,now-100,now-50),event(1,now-300,now-200)],now);expect(r.accounts[0]).toMatchObject({status:'observed_sequence',latest_observed_overwrite:{current_balance:32},current_account_state:null,economic_roi:null});
});
it('refuses to choose a last balance for overlapping or same-millisecond writes',()=>{
 for(const start of [now-250,now-200])expect(replay([event(1,now-300,now-200),event(2,start,now-50)],now).accounts[0]).toMatchObject({status:'unknown',latest_observed_overwrite:null});
});
it('excludes future data and retains mismatches and duplicate evidence',()=>{
 const a=event(1,now-300,now-200),future={...event(2,now-100,now-50),timestamp:new Date(now+1).toISOString()};expect(replay([a,future],now).accounts[0].writes).toHaveLength(1);
 expect(replay([a,a],now).unknown).toHaveLength(2);const bad=event(2,now-100,now-50);bad.event_data.update.current_balance=99;expect(replay([a,bad],now).unknown).toHaveLength(1);
});
it('applies statistics as field overwrites while retaining the observed wallet balance',()=>{
 const wallet=event(1,now-300,now-200);
 const stats={id:3,event_type:'account_net_statistics_applied',timestamp:new Date(now).toISOString(),event_data:{schema:'net-statistics-update-v1',account_id:1,statistics_attempt_id:'stats1',write_started_at:new Date(now-100).toISOString(),applied_at:new Date(now-50).toISOString(),input:{order:'close_time_desc',positions:[]},update:{total_trades:0,winning_trades:0,losing_trades:0,consecutive_losses:0,realized_pnl:0,accumulated_trading_fees:0,accumulated_funding_fee:0}}};
 const result=replay([stats,wallet],now);expect(result.accounts[0]).toMatchObject({status:'observed_sequence',latest_observed_overwrite:{current_balance:31},latest_observed_fields:{current_balance:31,realized_pnl:0,total_trades:0},economic_roi:null});
 expect(replay([wallet,stats,{...stats,id:4}],now).unknown).toHaveLength(2);
 const overlap={...stats,event_data:{...stats.event_data,write_started_at:new Date(now-250).toISOString()}};
 expect(replay([wallet,overlap],now).accounts[0]).toMatchObject({status:'unknown',latest_observed_fields:null});
});
it('applies recorded close increments only to known bases and requires DB-return provenance',async()=>{
 const {buildCloseAccountUpdate}=await import('../../src/utils/close-account-update');
 const close={id:4,position_id:'p1',event_type:'close_account_update_applied',timestamp:new Date(now).toISOString(),event_data:JSON.parse(JSON.stringify({schema:'close-account-update-v1',account_id:1,applied_clock_source:'db_update_return',applied_at:new Date(now-50).toISOString(),input:{balance:31,realized_pnl:-1,bookkeeping:false,fill_verified:true,binance_enabled:true,last_trade_time:new Date(now-120).toISOString(),updated_at:new Date(now-100).toISOString()},update:buildCloseAccountUpdate({balance:31,realizedPnl:-1,lastTradeTime:new Date(now-120),updatedAt:new Date(now-100)})}))};
 const r=replay([event(1,now-300,now-200),close],now).accounts[0];expect(r.latest_observed_fields).toMatchObject({current_balance:30,equity:30});expect(r.unresolved_increment_fields).toEqual(expect.arrayContaining(['total_trades','realized_pnl','consecutive_losses']));expect(r.latest_observed_fields).not.toHaveProperty('total_trades');
 const legacy=structuredClone(close);delete legacy.event_data.applied_clock_source;expect(replay([legacy],now).unknown).toHaveLength(1);
 const stats={id:3,event_type:'account_net_statistics_applied',timestamp:new Date(now).toISOString(),event_data:{schema:'net-statistics-update-v1',account_id:1,statistics_attempt_id:'stats',write_started_at:new Date(now-180).toISOString(),applied_at:new Date(now-150).toISOString(),input:{order:'close_time_desc',positions:[]},update:{total_trades:0,winning_trades:0,losing_trades:0,consecutive_losses:0,realized_pnl:0,accumulated_trading_fees:0,accumulated_funding_fee:0}}};
 const known=replay([event(1,now-300,now-200),stats,close],now).accounts[0];expect(known.latest_observed_fields).toMatchObject({current_balance:30,total_trades:1,realized_pnl:-1,consecutive_losses:1,losing_trades:1});expect(known.unresolved_increment_fields).toEqual([]);
 expect(replay([close,{...close,id:5}],now).unknown).toHaveLength(2);
});

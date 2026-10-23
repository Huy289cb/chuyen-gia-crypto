import {it,expect} from 'vitest';
import {replayAccountOverwriteTimeline as replay} from '../../src/utils/recorded-account-timeline';
const now=Date.parse('2026-10-03T00:00:00Z');
const event=(id:number,start:number,end:number)=>({id,event_type:'account_backfill_statistics_applied',timestamp:new Date(now).toISOString(),event_data:{schema:'account-backfill-statistics-v2',account_id:1,backfill_attempt_id:`00000000-0000-4000-8000-${String(id).padStart(12,'0')}`,kind:'trade_statistics_overwrite',input:{positions:[{position_id:'p1',close_reason:'manual',realized_pnl:1,pnl_status:'finite'}]},update:{total_trades:1,winning_trades:1,losing_trades:0,updated_at:new Date(start).toISOString()},write_started_at:new Date(start).toISOString(),applied_at:new Date(end).toISOString(),applied_clock_source:'db_update_return'}});
it('folds independently recorded statistics and paper PnL overwrites',()=>{
 const a=event(1,now-300,now-200),b:any=event(2,now-100,now-50);b.event_data.kind='paper_realized_overwrite';b.event_data.input.binance_enabled=false;b.event_data.update={realized_pnl:1,updated_at:new Date(now-100).toISOString()};
 expect(replay([b,a],now).accounts[0]).toMatchObject({status:'observed_sequence',latest_observed_fields:{total_trades:1,winning_trades:1,realized_pnl:1},current_account_state:null,economic_roi:null});
});
it('keeps attempt duplication/overlap/future limits',()=>{
 const a=event(1,now-300,now-200);expect(replay([a,{...a,id:2}],now).unknown).toHaveLength(2);
 expect(replay([a,event(3,now-250,now-50)],now).accounts[0].status).toBe('unknown');
 expect(replay([a,{...a,id:4,timestamp:new Date(now+1).toISOString()}],now).accounts[0].writes).toHaveLength(1);
});
it('preserves old schema and invalid/nonfinite row data as unknown',()=>{
 const a=event(1,now-100,now-50);expect(replay([{...a,event_data:{...a.event_data,schema:'account-backfill-statistics-v1'}}],now).unknown).toHaveLength(1);
 const b:any=structuredClone(a);b.event_data.input.positions[0].pnl_status='nonfinite';b.event_data.input.positions[0].realized_pnl=null;expect(replay([b],now).unknown).toHaveLength(1);
});

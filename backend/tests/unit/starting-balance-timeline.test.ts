import {it,expect} from 'vitest';
import {replayAccountOverwriteTimeline as replay} from '../../src/utils/recorded-account-timeline';
import {replayRecordedStartingBalance as adapter} from '../../src/utils/recorded-starting-balance';
const now=Date.parse('2026-10-03T00:00:00Z');
const event=(id:number,start:number,end:number)=>({id,event_type:'account_starting_balance_sync_applied',timestamp:new Date(now).toISOString(),event_data:{schema:'account-starting-balance-sync-v1',account_id:1,capital_attempt_id:`00000000-0000-4000-8000-${String(id).padStart(12,'0')}`,input:{total_trades:0,previous_starting_balance:30,wallet_balance:31},update:{starting_balance:31},write_started_at:new Date(start).toISOString(),applied_at:new Date(end).toISOString(),applied_clock_source:'db_update_return'}});
it('folds only capital field without synthesizing balance or ROI',()=>{
 const r=replay([event(1,now-100,now-50)],now).accounts[0];expect(r).toMatchObject({status:'observed_sequence',latest_observed_fields:{starting_balance:31},latest_observed_overwrite:null,economic_roi:null});expect(r.latest_observed_fields).not.toHaveProperty('current_balance');
});
it('retains duplicate/overlap and future cutoff rules',()=>{
 const a=event(1,now-300,now-200);expect(replay([a,{...a,id:2}],now).unknown).toHaveLength(2);expect(replay([a,event(3,now-250,now-50)],now).accounts[0].status).toBe('unknown');expect(replay([a,{...a,id:4,timestamp:new Date(now+1).toISOString()}],now).accounts[0].writes).toHaveLength(1);
});
it('requires zero selected trades and exact write with known clocks',()=>{
 const a=event(1,now-100,now-50).event_data;expect(adapter({...a,input:{...a.input,total_trades:1}},now,now)).toMatchObject({status:'unknown'});expect(adapter({...a,update:{starting_balance:99}},now,now)).toMatchObject({matches_recorded:false});expect(adapter({...a,applied_clock_source:null},now,now)).toMatchObject({status:'unknown'});
});

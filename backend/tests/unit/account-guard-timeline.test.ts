import {it,expect} from 'vitest';
import {replayAccountOverwriteTimeline as replay} from '../../src/utils/recorded-account-timeline';
const now=Date.parse('2026-10-03T00:00:00Z');
const mutation=(id:number,start:number,end:number)=>({id,event_type:'account_guard_mutation_applied',timestamp:new Date(now).toISOString(),event_data:{schema:'account-guard-mutation-v1',account_id:1,mutation_attempt_id:`00000000-0000-4000-8000-${String(id).padStart(12,'0')}`,kind:'exchange_loss_streak_overwrite',input:{symbol:'BTC',previous_consecutive_losses:0,consecutive_losses:id,last_loss_time:0},update:{consecutive_losses:id},write_started_at:new Date(start).toISOString(),applied_at:new Date(end).toISOString(),applied_clock_source:'db_update_return'}});
it('folds guard overwrite by observed write clocks, not persistence sequence',()=>{
 const r=replay([mutation(2,now-100,now-50),mutation(1,now-300,now-200)],now);
 expect(r.accounts[0]).toMatchObject({status:'observed_sequence',latest_observed_fields:{consecutive_losses:2},latest_observed_overwrite:null,current_account_state:null,economic_roi:null});
 expect(r.accounts[0].writes.map(w=>w.event_id)).toEqual([1,2]);expect(r.unknown).toEqual([]);
});
it('retains duplicate attempts and mismatches as unknown',()=>{
 const a=mutation(1,now-300,now-200);
 expect(replay([a,{...a,id:3}],now).unknown).toHaveLength(2);
 const bad=structuredClone(a);bad.event_data.update.consecutive_losses=99;
 expect(replay([bad],now).unknown).toHaveLength(1);
});
it('rejects overlap and excludes future duplicate before identity resolution',()=>{
 const a=mutation(1,now-300,now-200),b=mutation(2,now-250,now-100);
 expect(replay([a,b],now).accounts[0]).toMatchObject({status:'unknown',latest_observed_fields:null});
 expect(replay([a,{...a,id:4,timestamp:new Date(now+1).toISOString()}],now).accounts[0].writes).toHaveLength(1);
});
it('folds a shared verified expired cooldown clear',()=>{
 const a:any=mutation(1,now-100,now-50);a.event_data.kind='expired_cooldown_clear';
 a.event_data.input={protective_block:null,cooldown_until:new Date(now-1000).toISOString(),now:new Date(now-200).toISOString(),consecutive_losses:0,max_consecutive_losses:2};a.event_data.update={cooldown_until:null};
 expect(replay([a],now).accounts[0].latest_observed_fields).toEqual({cooldown_until:null});
 a.event_data.input.protective_block={reason:'missing SL'};
 expect(replay([a],now).unknown).toHaveLength(1);
});

import {it,expect} from 'vitest';
import {replayRecordedAccountCooldownSet as adapter} from '../../src/utils/recorded-account-cooldown-set';
import {replayAccountOverwriteTimeline as replay} from '../../src/utils/recorded-account-timeline';
const now=Date.parse('2026-10-03T00:00:00Z');
const event=(id:number,start:number,end:number)=>({id,event_type:'account_cooldown_set_applied',timestamp:new Date(now).toISOString(),event_data:{schema:'account-cooldown-set-v1',account_id:1,cooldown_attempt_id:`00000000-0000-4000-8000-${String(id).padStart(12,'0')}`,input:{cooldown_until:new Date(now+id*1000).toISOString()},update:{cooldown_until:new Date(now+id*1000).toISOString()},write_started_at:new Date(start).toISOString(),applied_at:new Date(end).toISOString(),applied_clock_source:'db_update_return'}});
it('folds cooldown overwrites without requiring expiry before knowledge time',()=>{
 const a=event(1,now-300,now-200),b=event(2,now-100,now-50);
 expect(replay([b,a],now).accounts[0]).toMatchObject({status:'observed_sequence',latest_observed_fields:{cooldown_until:b.event_data.update.cooldown_until},economic_roi:null});
});
it('retains duplicate attempts, overlaps and corrupted output',()=>{
 const a=event(1,now-300,now-200);
 expect(replay([a,{...a,id:4}],now).unknown).toHaveLength(2);
 expect(replay([a,event(2,now-250,now-50)],now).accounts[0].status).toBe('unknown');
 expect(adapter({...a.event_data,update:{cooldown_until:null}},now,now)).toMatchObject({matches_recorded:false});
});
it('requires known applied clocks and valid identity, preserving missing evidence',()=>{
 const d=event(1,now-300,now-200).event_data;
 for(const patch of [{account_id:0},{cooldown_attempt_id:'missing'},{applied_clock_source:null},{applied_at:new Date(now+1).toISOString()},{input:{cooldown_until:null}}])
 expect(adapter({...d,...patch},now,now)).toMatchObject({status:'unknown'});
});

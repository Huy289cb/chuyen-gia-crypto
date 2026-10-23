import {it,expect} from 'vitest';
import {replayAccountOverwriteTimeline as replay} from '../../src/utils/recorded-account-timeline';
import {replayRecordedPrecisionReset as adapter} from '../../src/utils/recorded-precision-reset';
import {buildPrecisionResetUpdate} from '../../src/utils/precision-reset-update';
const now=Date.parse('2026-10-03T00:00:00Z');
const event=(id:number,start:number,end:number)=>({id,event_type:'account_precision_reset_applied',timestamp:new Date(now).toISOString(),event_data:{schema:'account-precision-reset-v1',account_id:1,precision_attempt_id:`00000000-0000-4000-8000-${String(id).padStart(12,'0')}`,input:{updated_at:new Date(start).toISOString()},update:JSON.parse(JSON.stringify(buildPrecisionResetUpdate(new Date(start)))),write_started_at:new Date(start).toISOString(),applied_at:new Date(end).toISOString(),applied_clock_source:'db_update_return'}});
it('folds precision-only reset with explicit recorded clocks',()=>{
 const r=replay([event(1,now-100,now-50)],now);expect(r.accounts[0]).toMatchObject({status:'observed_sequence',latest_observed_fields:{precision_error_count:0,precision_cooldown_until:null},economic_roi:null});
 expect(r.accounts[0].latest_observed_fields).not.toHaveProperty('current_balance');expect(r.accounts[0].latest_observed_fields).not.toHaveProperty('cooldown_until');
});
it('retains duplicate and overlap ambiguity and excludes future duplicates',()=>{
 const a=event(1,now-300,now-200);expect(replay([a,{...a,id:2}],now).unknown).toHaveLength(2);
 expect(replay([a,event(3,now-250,now-50)],now).accounts[0].status).toBe('unknown');
 expect(replay([a,{...a,id:4,timestamp:new Date(now+1).toISOString()}],now).accounts[0].writes).toHaveLength(1);
});
it('requires exact fields and DB provenance rather than treating any reset as supported',()=>{
 const a=event(1,now-100,now-50).event_data;
 expect(adapter({...a,update:{...a.update,cooldown_until:null}},now,now)).toMatchObject({matches_recorded:false});
 expect(adapter({...a,applied_clock_source:null},now,now)).toMatchObject({status:'unknown'});
 expect(adapter({...a,input:{updated_at:new Date(now).toISOString()}},now,now)).toMatchObject({status:'unknown'});
});

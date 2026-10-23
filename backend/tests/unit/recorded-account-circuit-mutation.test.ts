import {it,expect} from 'vitest';
import {replayRecordedAccountCircuitMutation as replay} from '../../src/utils/recorded-account-circuit-mutation';
const now=Date.parse('2026-10-03T00:00:00Z');
const record={schema:'account-circuit-mutation-v1',account_id:1,circuit_attempt_id:'00000000-0000-4000-8000-000000000001',kind:'max_drawdown_overwrite',write_started_at:new Date(now-2).toISOString(),applied_at:new Date(now-1).toISOString(),applied_clock_source:'db_update_return',input:{previous_max_drawdown:0,equity:30,peak_equity:40,drawdown_percent:25,peak_equity_source:'override'},update:{max_drawdown:25}};
it('checks shared drawdown computation and exact write',()=>{
 expect(replay(record,now,now)).toMatchObject({status:'evaluated',matches_recorded:true});
 expect(replay({...record,update:{max_drawdown:99}},now,now)).toMatchObject({matches_recorded:false});
 expect(replay({...record,input:{...record.input,drawdown_percent:99}},now,now)).toMatchObject({status:'unknown'});
 expect(replay({...record,input:{...record.input,previous_max_drawdown:25}},now,now)).toMatchObject({status:'unknown'});
});
it('requires write provenance, knowledge cutoff and attempt identity',()=>{
 for(const patch of [{applied_clock_source:null},{circuit_attempt_id:'missing'},{account_id:0},{applied_at:new Date(now+1).toISOString()}])expect(replay({...record,...patch},now,now)).toMatchObject({status:'unknown'});
});
it('rejects unsupported expectancy expiry or sticky overwrite',()=>{
 const r={...record,kind:'expectancy_cooldown_overwrite',input:{allowed:false,reason:'Expectancy kill: test',cooldown_hours:1,selected_at:new Date(now-10).toISOString(),selected_until:new Date(now-10+3600000).toISOString(),previous_cooldown_status:'absent',previous_cooldown_until:null},update:{cooldown_until:new Date(now-10+3600000).toISOString()}};
 expect(replay(r,now,now)).toMatchObject({status:'evaluated',matches_recorded:true});
 expect(replay({...r,input:{...r.input,selected_until:new Date(now+3600000).toISOString()}},now,now)).toMatchObject({status:'unknown'});
 expect(replay({...r,input:{...r.input,previous_cooldown_status:'valid',previous_cooldown_until:new Date(now+7200000).toISOString()}},now,now)).toMatchObject({status:'unknown'});
});

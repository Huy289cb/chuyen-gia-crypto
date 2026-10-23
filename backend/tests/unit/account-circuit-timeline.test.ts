import {it,expect} from 'vitest';
import {replayAccountOverwriteTimeline as replay} from '../../src/utils/recorded-account-timeline';
const now=Date.parse('2026-10-03T00:00:00Z');
const circuit=(id:number,start:number,end:number)=>({id,event_type:'account_circuit_mutation_applied',timestamp:new Date(now).toISOString(),event_data:{schema:'account-circuit-mutation-v1',account_id:1,circuit_attempt_id:`00000000-0000-4000-8000-${String(id).padStart(12,'0')}`,kind:'max_drawdown_overwrite',write_started_at:new Date(start).toISOString(),applied_at:new Date(end).toISOString(),applied_clock_source:'db_update_return',input:{previous_max_drawdown:0,equity:30,peak_equity:40,drawdown_percent:25,peak_equity_source:'override'},update:{max_drawdown:25}}});
it('folds verified circuit writes with local cooldown setters',()=>{
 const a=circuit(1,now-300,now-200),until=new Date(now+3600000).toISOString();
 const b={id:2,event_type:'account_cooldown_set_applied',timestamp:new Date(now).toISOString(),event_data:{schema:'account-cooldown-set-v1',account_id:1,cooldown_attempt_id:'00000000-0000-4000-8000-000000000002',input:{cooldown_until:until},update:{cooldown_until:until},write_started_at:new Date(now-100).toISOString(),applied_at:new Date(now-50).toISOString(),applied_clock_source:'db_update_return'}};
 expect(replay([b,a],now).accounts[0]).toMatchObject({status:'observed_sequence',latest_observed_fields:{max_drawdown:25,cooldown_until:until},current_account_state:null,economic_roi:null});
});
it('preserves duplicate, overlap, corruption and future evidence limits',()=>{
 const a=circuit(1,now-300,now-200);
 expect(replay([a,{...a,id:2}],now).unknown).toHaveLength(2);
 expect(replay([a,circuit(3,now-250,now-50)],now).accounts[0].status).toBe('unknown');
 const bad=structuredClone(a);bad.event_data.update.max_drawdown=99;expect(replay([bad],now).unknown).toHaveLength(1);
 expect(replay([a,{...a,id:4,timestamp:new Date(now+1).toISOString()}],now).accounts[0].writes).toHaveLength(1);
});
it('folds expectancy cooldown only with verified selected clock and sticky rule',()=>{
 const a:any=circuit(1,now-100,now-50),until=new Date(now-200+3600000).toISOString();a.event_data.kind='expectancy_cooldown_overwrite';a.event_data.input={allowed:false,reason:'Expectancy kill: test',cooldown_hours:1,selected_at:new Date(now-200).toISOString(),selected_until:until,previous_cooldown_status:'absent',previous_cooldown_until:null};a.event_data.update={cooldown_until:until};
 expect(replay([a],now).accounts[0].latest_observed_fields).toEqual({cooldown_until:until});
 a.event_data.input.previous_cooldown_status='invalid';expect(replay([a],now).unknown).toHaveLength(1);
});

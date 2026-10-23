import {it,expect} from 'vitest';
import {buildAccountResetReceipt as build} from '../../src/utils/account-reset-receipt';
import {replayRecordedAccountReset as replay} from '../../src/utils/recorded-account-reset';
const now=Date.parse('2026-10-03T00:00:00Z'),id='00000000-0000-4000-8000-000000000001';
const row=()=>({attempt_id:id,account_id:1,mutation_kind:'admin_local_reset',recorded_at:new Date(now-50).toISOString(),evidence:build(1,id,30,new Date(now-100))});
it('replays exact reset assignments without inferring commit time/current state',()=>{expect(replay(row(),now,now)).toMatchObject({status:'evaluated',matches_recorded:true,commit_time:null,commit_order:'not_established',current_account_state:null,economic_total_pnl:null});});
it('detects altered assignment or added reset fields',()=>{const a=row();a.evidence.update.current_balance=999;expect(replay(a,now,now)).toMatchObject({status:'evaluated',matches_recorded:false});const b=row();b.evidence.update.precision_error_count=0;expect(replay(b,now,now)).toMatchObject({status:'evaluated',matches_recorded:false});});
it('rejects identity, clock, scope, input and unsupported exchange claims',()=>{for(const mutate of [(r:any)=>r.account_id=2,(r:any)=>r.attempt_id='invalid',(r:any)=>r.recorded_at=new Date(now+1).toISOString(),(r:any)=>r.evidence.input.starting_balance=null,(r:any)=>r.evidence.deleted_local_history=[],(r:any)=>r.evidence.exchange_flatness_verified=true]){const r=row();mutate(r);expect(replay(r,now,now).status).toBe('unknown');}expect(replay(row(),now+1,now).status).toBe('unknown');});

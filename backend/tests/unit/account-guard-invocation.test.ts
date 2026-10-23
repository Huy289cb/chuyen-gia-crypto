import {it,expect,vi} from 'vitest';
import {runGuardInvocation,currentGuardInvocation} from '../../src/utils/account-guard-invocation';
import {tracedEvent} from '../../src/utils/entry-trace';
it('separates concurrent calls and propagates identity through awaited circuit-like stages',async()=>{
 const events:any[]=[];const emit=async(stage:string,data:any)=>{events.push({stage,...tracedEvent(data)});};
 let release!:()=>void;const wait=new Promise<void>(r=>{release=r;});
 const a=runGuardInvocation(1,'BTC',async()=>{const before=currentGuardInvocation();await wait;expect(currentGuardInvocation()).toEqual(before);await emit('circuit',{account_id:1});return {allowed:true,reason:'clear',remainingDailyRiskUsd:2};},emit);
 const b=runGuardInvocation(2,undefined,async()=>{await emit('circuit',{account_id:2});release();return {allowed:false,reason:'missing account'};},emit);
 await Promise.all([a,b]);expect(currentGuardInvocation()).toBeUndefined();expect(tracedEvent({stage:'health'}).guard_invocation_id).toBeUndefined();
 const starts=events.filter(e=>e.stage==='account_guard_invocation_started');expect(new Set(starts.map(e=>e.guard_invocation_id)).size).toBe(2);
 for(const start of starts){const related=events.filter(e=>e.guard_invocation_id===start.guard_invocation_id);expect(related.map(e=>e.stage)).toEqual(['account_guard_invocation_started','circuit','account_guard_invocation_finished']);expect(related.every(e=>e.guard_account_id===start.account_id&&e.account_id===start.account_id)).toBe(true);}
});
it('records terminal veto/nonfinite output and rethrows the original error without its content',async()=>{
 const rows:any[]=[];const emit=async(stage:string,data:any)=>{rows.push({stage,...data});};
 const veto={allowed:false,reason:'missing account'};expect(await runGuardInvocation(1,'BTC',async()=>veto,emit)).toBe(veto);
 await runGuardInvocation(1,'BTC',async()=>({allowed:true,reason:'clear',remainingDailyRiskUsd:NaN}),emit);expect(rows.at(-1).financial_output_status).toBe('nonfinite');
 const failure=Error('private fixture content');await expect(runGuardInvocation(1,'BTC',async()=>{throw failure;},emit)).rejects.toBe(failure);expect(rows.at(-1)).toMatchObject({outcome:'threw',decision:null});expect(JSON.stringify(rows)).not.toContain(failure.message);expect(currentGuardInvocation()).toBeUndefined();
});
it('does not change a returned decision or original exception when journal fails',async()=>{
 const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});try{const emit=async()=>{throw Error('journal failed');};const d={allowed:false,reason:'veto'};expect(await runGuardInvocation(1,'BTC',async()=>d,emit)).toBe(d);const error=Error('original');await expect(runGuardInvocation(1,'BTC',async()=>{throw error;},emit)).rejects.toBe(error);}finally{warning.mockRestore();}
});

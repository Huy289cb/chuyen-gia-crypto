import { it, expect } from 'vitest';
import { reduceSetupLifecycle, type SetupLifecycleEvent } from '../../src/utils/setup-lifecycle';
const event:SetupLifecycleEvent={event_id:'1',setup_id:'a',kind:'observed',occurred_at:10,known_at:15,detector_version:'v1'};
it('preserves first known time, confirmation and terminal history without mutating prior state',()=>{
 const first=reduceSetupLifecycle(null,event,20);
 const confirmed=reduceSetupLifecycle(first,{...event,event_id:'2',kind:'confirmed',known_at:20},20);
 const repeat=reduceSetupLifecycle(confirmed,{...event,event_id:'3',known_at:25},25);
 const final=reduceSetupLifecycle(repeat,{...event,event_id:'4',kind:'invalidated',known_at:30},30);
 expect(first.status).toBe('observed');expect(final.first_seen_at).toBe(15);
 expect(repeat.status).toBe('confirmed');expect(final.confirmed_at).toBe(20);expect(final.invalidated_at).toBe(30);
 expect(()=>reduceSetupLifecycle(final,{...event,event_id:'5',known_at:35},35)).toThrow('terminal');
});
it('rejects future knowledge, unknown origins, duplicate delivery and out-of-order history',()=>{
 expect(()=>reduceSetupLifecycle(null,event,14)).toThrow('future');
 expect(()=>reduceSetupLifecycle(null,{...event,kind:'confirmed'},20)).toThrow('first_event');
 const first=reduceSetupLifecycle(null,event,20);
 expect(()=>reduceSetupLifecycle(first,event,20)).toThrow('duplicate');
 expect(()=>reduceSetupLifecycle(first,{...event,event_id:'2',known_at:14},20)).toThrow('order');
 expect(()=>reduceSetupLifecycle(first,{...event,event_id:'2',setup_id:'b'},20)).toThrow('identity');
});

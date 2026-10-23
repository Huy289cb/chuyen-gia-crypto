import { describe, it, expect } from 'vitest';
import { withEntryTrace, currentEntryTrace, tracedEvent, type EntryTrace } from '../../src/utils/entry-trace';
import type { SetupIdentity } from '../../src/utils/setup-identity';
const identity: SetupIdentity = {schema:'setup-anchor-identity-v1',status:'known',setup_id:'recorded-anchor',wave_id:null,anchor_known_at:1,detection_known_at:2};
function trace(id:string):EntryTrace{return {trace_id:id,lane:'legacy_signal',policy_hash:'frozen',evaluated_at:'2026-10-02T00:00:00Z'};}
describe('setup identity propagation',()=>{
 it('keeps decision stages linked and parallel scopes isolated',async()=>{
  const first=trace('first'),second=trace('second');
  const results=await Promise.all([
   withEntryTrace(first,async()=>{currentEntryTrace()!.setup_identity=identity;await Promise.resolve();return tracedEvent({stage:'risk_checked'});}),
   withEntryTrace(second,async()=>{await Promise.resolve();return tracedEvent({stage:'admission_rejected'});}),
  ]);
  expect(results[0].setup_identity).toEqual(identity);expect(results[0].trace_id).toBe('first');
  expect(results[1].setup_identity).toBeUndefined();expect(results[1].trace_id).toBe('second');
  expect(currentEntryTrace()).toBeUndefined();
 });
});

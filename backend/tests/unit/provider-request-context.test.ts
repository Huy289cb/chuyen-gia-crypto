import {it,expect} from 'vitest';
import {captureProviderRequestContext as capture} from '../../src/utils/provider-request-context';
import {withEntryTrace} from '../../src/utils/entry-trace';
const trace=(id:string)=>({trace_id:id,lane:'test',policy_hash:'p',code_hash:'c',evaluated_at:'2026-10-03T00:00:00Z'});
it('explicitly identifies absent context without fabricating trace',()=>{expect(capture()).toMatchObject({caller_context_status:'not_supplied',trace_id:null,lane:null});});
it('snapshots caller fields without following later mutable context changes',()=>{const t=trace('a');withEntryTrace(t,()=>{const captured=capture();t.trace_id='changed';expect(captured.trace_id).toBe('a');});});
it('isolates concurrently running caller contexts',async()=>{const results=await Promise.all(['a','b'].map(id=>withEntryTrace(trace(id),async()=>{await Promise.resolve();return capture();})));expect(results.map(r=>r.trace_id)).toEqual(['a','b']);});

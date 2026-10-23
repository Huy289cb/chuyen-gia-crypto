vi.mock('../../src/repositories/provider-journal.repository', () => ({insertProviderJournalEvent: vi.fn().mockResolvedValue(undefined)}));
import { insertProviderJournalEvent } from '../../src/repositories/provider-journal.repository';
import {withProviderPurpose} from '../../src/utils/provider-purpose-context';
import {withEntryTrace} from '../../src/utils/entry-trace';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../src/repositories/testnet.repository', () => ({recordSilentPipelineEvent: vi.fn().mockResolvedValue(1)}));
import { recordSilentPipelineEvent } from '../../src/repositories/testnet.repository';
import { fetchWithLlmTelemetry } from '../../src/services/llm-telemetry.service';
beforeEach(() => { vi.clearAllMocks(); vi.mocked(insertProviderJournalEvent).mockReset().mockResolvedValue(undefined); vi.mocked(recordSilentPipelineEvent).mockResolvedValue(1); vi.stubEnv('NODE_ENV','production'); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('records real request attempts and HTTP outcomes without retaining credentials or prompts', async () => {
  const response = new Response('{}', {status: 200});
  const fetch = vi.fn().mockResolvedValue(response); vi.stubGlobal('fetch',fetch);
  const result=await fetchWithLlmTelemetry('https://example.invalid/chat',{
    method:'POST',headers:{Authorization:'Bearer private-test-secret'},body:JSON.stringify({model:'test-model',messages:[{content:'private prompt'}]})});
  expect(result).toBe(response); expect(fetch).toHaveBeenCalledOnce();
  expect(recordSilentPipelineEvent).toHaveBeenNthCalledWith(1,'llm_provider_request',expect.objectContaining({provider:'example.invalid',model:'test-model'}));
  expect(recordSilentPipelineEvent).toHaveBeenNthCalledWith(2,'llm_provider_result',expect.objectContaining({status:200,ok:true}));
  const persisted=JSON.stringify(vi.mocked(recordSilentPipelineEvent).mock.calls);
  expect(persisted).not.toContain('private-test-secret'); expect(persisted).not.toContain('private prompt');
});
it('records failed HTTP attempts and propagates the failure to provider fallback', async () => {
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('connection failed')));
  await expect(fetchWithLlmTelemetry('https://example.invalid/chat')).rejects.toThrow('connection failed');
  expect(recordSilentPipelineEvent).toHaveBeenNthCalledWith(2,'llm_provider_result',expect.objectContaining({status:null,ok:false}));
});

it('captures reported cost without consuming the caller response', async () => {
  const response=new Response(JSON.stringify({usage:{cost:.001,prompt_tokens:10,completion_tokens:5},choices:[{message:{content:'private response'}}]}));
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));
  const result=await fetchWithLlmTelemetry('https://example.invalid/chat',{body:'{"model":"test"}'});
  expect(await result.json()).toHaveProperty('choices');
  expect(recordSilentPipelineEvent).toHaveBeenNthCalledWith(2,'llm_provider_result',expect.objectContaining({cost_usd:.001,cost_status:'reported',input_tokens:10,output_tokens:5}));
  expect(JSON.stringify(vi.mocked(recordSilentPipelineEvent).mock.calls)).not.toContain('private response');
});

it('warns on null persistence without changing provider response or leaking payload',async()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 vi.mocked(recordSilentPipelineEvent).mockResolvedValue(null);
 const response=new Response('{}');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));
 expect(await fetchWithLlmTelemetry('https://example.invalid/chat',{body:'{"model":"test"}'})).toBe(response);
 expect(warn).toHaveBeenCalledTimes(2);
 expect(warn.mock.calls).toEqual([["[LlmTelemetry] Could not persist provider request metadata"],["[LlmTelemetry] Could not persist provider request metadata"]]);
});
it('preserves original network failure even when telemetry persistence fails',async()=>{
 vi.spyOn(console,'warn').mockImplementation(()=>{});vi.mocked(recordSilentPipelineEvent).mockRejectedValue(new Error('private DB failure'));
 const failure=new Error('network failure');vi.stubGlobal('fetch',vi.fn().mockRejectedValue(failure));
 await expect(fetchWithLlmTelemetry('https://example.invalid/chat')).rejects.toBe(failure);
});

it('uses the same caller snapshot on request and result despite subsequent context mutation',async()=>{
 const trace={trace_id:'caller-a',lane:'pending-review',policy_hash:'p',evaluated_at:'2026-10-03T00:00:00Z'};
 vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>{trace.trace_id='changed';trace.lane='changed';return new Response('{}');}));
 await withEntryTrace(trace,()=>fetchWithLlmTelemetry('https://example.invalid/chat'));
 for(const call of vi.mocked(recordSilentPipelineEvent).mock.calls)expect(call[1]).toMatchObject({trace_id:'caller-a',lane:'pending-review',caller_context_status:'entry_trace_snapshot'});
});

it('emits explicit purpose on both actual producer payloads',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}')));
 await withProviderPurpose('pending_review',()=>fetchWithLlmTelemetry('https://example.invalid/chat'));
 expect(recordSilentPipelineEvent).toHaveBeenCalledTimes(2);
 for(const call of vi.mocked(recordSilentPipelineEvent).mock.calls)expect(call[1]).toMatchObject({provider_purpose:'pending_review',caller_context_status:'not_supplied',trace_id:null});
});

it('writes independent evidence even when the deletable pipeline writer fails',async()=>{
 vi.mocked(recordSilentPipelineEvent).mockResolvedValue(null);const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 const response=new Response('{}');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));
 expect(await fetchWithLlmTelemetry('https://example.invalid/chat')).toBe(response);
 expect(insertProviderJournalEvent).toHaveBeenCalledTimes(2);
 expect(vi.mocked(insertProviderJournalEvent).mock.calls.map(c=>c[0])).toEqual(['llm_provider_request','llm_provider_result']);
 expect(warn).toHaveBeenCalledTimes(2);
});
it('preserves pipeline evidence and original network error when independent persistence fails',async()=>{
 const error=new Error('fixture network error');vi.mocked(insertProviderJournalEvent).mockRejectedValue(Error('private database diagnostics'));
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});vi.stubGlobal('fetch',vi.fn().mockRejectedValue(error));
 await expect(fetchWithLlmTelemetry('https://example.invalid/chat')).rejects.toBe(error);
 expect(recordSilentPipelineEvent).toHaveBeenCalledTimes(2);expect(insertProviderJournalEvent).toHaveBeenCalledTimes(2);
 expect(warn).toHaveBeenCalledTimes(2);expect(JSON.stringify(warn.mock.calls)).not.toContain('private database diagnostics');
});

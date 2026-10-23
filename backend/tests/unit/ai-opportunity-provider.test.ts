import { currentProviderPurpose, withProviderPurpose } from '../../src/utils/provider-purpose-context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestOpportunityReview } from '../../src/services/ai-opportunity-provider';
import { opportunityFixture } from '../fixtures/ai-opportunity';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('opportunity provider boundary', () => {
  it('sends no tools, honors cancellation, uses one request and preserves unknown cost', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'unit-test-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: 'returned-model',
      choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 12 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock); const controller = new AbortController();
    const response = await requestOpportunityReview('system', 'snapshot', opportunityFixture().policy, controller.signal);
    expect(response.costUsd).toBeNull(); expect(response.inputTokens).toBe(12); expect(response.outputTokens).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const options = fetchMock.mock.calls[0][1]; expect(options.signal).toBe(controller.signal);
    const body = JSON.parse(options.body); expect(body.tools).toBeUndefined(); expect(body.max_tokens).toBe(600);
    expect(JSON.stringify(body)).not.toContain('unit-test-key');
  });
  it('HTTP failure neither leaks body nor retries', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'unit-test-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response('sensitive provider diagnostics', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestOpportunityReview('s', 'u', opportunityFixture().policy, new AbortController().signal)).rejects.toThrow('provider_http_429');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('missing key and oversized snapshot fail before network', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', ''); const f = vi.fn(); vi.stubGlobal('fetch', f);
    await expect(requestOpportunityReview('s', 'u', opportunityFixture().policy, new AbortController().signal)).rejects.toThrow();
    vi.stubEnv('OPENROUTER_API_KEY', 'unit-test-key');
    await expect(requestOpportunityReview('s', 'x'.repeat(180001), opportunityFixture().policy, new AbortController().signal)).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});

it('labels opportunity requests and restores an enclosing purpose after success', async()=>{
 vi.stubEnv('OPENROUTER_API_KEY','unit-test-key');
 const fetchMock=vi.fn(async()=>{expect(currentProviderPurpose()).toBe('opportunity_review');return new Response(JSON.stringify({choices:[{message:{content:'{}'}}]}),{status:200});});
 vi.stubGlobal('fetch',fetchMock);
 await withProviderPurpose('dispatch',async()=>{await requestOpportunityReview('s','u',opportunityFixture().policy,new AbortController().signal);expect(currentProviderPurpose()).toBe('dispatch');});
 expect(currentProviderPurpose()).toBeNull();expect(fetchMock).toHaveBeenCalledOnce();
});
it('restores the enclosing purpose on network rejection and preserves the original error',async()=>{
 vi.stubEnv('OPENROUTER_API_KEY','unit-test-key');const error=new Error('fixture network failure');
 const fetchMock=vi.fn(async()=>{expect(currentProviderPurpose()).toBe('opportunity_review');throw error;});vi.stubGlobal('fetch',fetchMock);
 await withProviderPurpose('shadow',async()=>{await expect(requestOpportunityReview('s','u',opportunityFixture().policy,new AbortController().signal)).rejects.toBe(error);expect(currentProviderPurpose()).toBe('shadow');});
 expect(currentProviderPurpose()).toBeNull();expect(fetchMock).toHaveBeenCalledOnce();
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiOpportunityReviewer, type OpportunityReviewDependencies } from '../../src/services/ai-opportunity-review.service';
import { opportunityFixture } from '../fixtures/ai-opportunity';

function harness(mode: 'shadow' | 'live' | 'off' = 'live') {
  const f = opportunityFixture(); f.policy.mode = mode;
  const result = { content: JSON.stringify({ decision: 'take', plan_id: f.plan.id,
    reason_codes: ['retest'], evidence_ids: ['trend1h'], missing_confirmation: null }),
    model: 'fixture', inputTokens: 100, outputTokens: 10, costUsd: .001 };
  const deps: OpportunityReviewDependencies = {
    now: () => f.now, policy: () => f.policy, snapshot: vi.fn(async () => f.snapshot),
    claim: vi.fn(async () => 42), provider: vi.fn(async () => result), record: vi.fn(async () => {}),
    current: vi.fn(async () => ({ finance: f.finance, price: f.plan.entry })),
    claimExecution: vi.fn(async () => true), execute: vi.fn(async () => ({ success: true, reason: 'mock_execution' })),
    livePolicyHash: () => f.policy.hash,
  };
  return { f, result, deps, reviewer: new AiOpportunityReviewer(deps) };
}
afterEach(() => vi.useRealTimers());
describe('AI opportunity orchestration (all exchange calls mocked)', () => {
  it('off does no IO', async () => {
    const h = harness('off'); await h.reviewer.run(); expect(h.deps.snapshot).not.toHaveBeenCalled();
  });
  it('shadow persists a choice but never executes', async () => {
    const h = harness('shadow'); expect((await h.reviewer.run()).reason).toBe('shadow_take');
    expect(h.deps.record).toHaveBeenCalled(); expect(h.deps.current).not.toHaveBeenCalled(); expect(h.deps.execute).not.toHaveBeenCalled();
  });
  it('live passes an unchanged sealed plan through revalidation and durable execution claim', async () => {
    const h = harness(); expect((await h.reviewer.run()).handled).toBe(true);
    expect(h.deps.execute).toHaveBeenCalledWith(h.f.plan, h.f.snapshot, 42);
    expect(vi.mocked(h.deps.record).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(h.deps.execute).mock.invocationCallOrder[0]);
    expect(vi.mocked(h.deps.claimExecution).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(h.deps.execute).mock.invocationCallOrder[0]);
  });
  it('quota or duplicate causes zero provider requests', async () => {
    const h = harness(); vi.mocked(h.deps.claim).mockResolvedValue(null); await h.reviewer.run(); expect(h.deps.provider).not.toHaveBeenCalled();
  });
  it('missing live policy pin cannot execute', async () => {
    const h = harness(); h.deps.livePolicyHash = () => undefined; await h.reviewer.run(); expect(h.deps.execute).not.toHaveBeenCalled();
  });
  it.each(['wait', 'reject', 'invalid'] as const)('does not execute %s', async decision => {
    const h = harness(); h.result.content = decision === 'invalid' ? '{}' : JSON.stringify({ decision, plan_id: null,
      reason_codes: ['no_confirmation'], evidence_ids: ['trend1h'], missing_confirmation: null });
    await h.reviewer.run(); expect(h.deps.execute).not.toHaveBeenCalled();
  });
  it('model cannot substitute another plan', async () => {
    const h = harness(); h.result.content = h.result.content.replace(h.f.plan.id, 'unknown');
    await h.reviewer.run(); expect(h.deps.execute).not.toHaveBeenCalled();
  });
  it('write failure before execution blocks trading', async () => {
    const h = harness(); vi.mocked(h.deps.record).mockRejectedValue(new Error('db unavailable'));
    await h.reviewer.run(); expect(h.deps.execute).not.toHaveBeenCalled();
  });
  it.each(['balance', 'price', 'expiry', 'mode', 'policy'] as const)('revalidates %s after provider', async kind => {
    const h = harness();
    vi.mocked(h.deps.current).mockImplementation(async () => {
      if (kind === 'expiry') h.f.now += 200000;
      if (kind === 'mode') h.f.policy.mode = 'off';
      if (kind === 'policy') h.f.policy.hash = 'changed';
      return { finance: { ...h.f.finance, balance: kind === 'balance' ? 1 : h.f.finance.balance },
        price: kind === 'price' ? h.f.plan.entry * 1.01 : h.f.plan.entry };
    });
    await h.reviewer.run(); expect(h.deps.execute).not.toHaveBeenCalled();
  });
  it('does not execute twice when persistent attempt already exists', async () => {
    const h = harness(); vi.mocked(h.deps.claimExecution).mockResolvedValue(false);
    await h.reviewer.run(); expect(h.deps.execute).not.toHaveBeenCalled();
  });
  it('kills a timed-out call even if provider ignores abort, never late-executes', async () => {
    vi.useFakeTimers(); const h = harness(); let signal: AbortSignal | undefined;
    vi.mocked(h.deps.provider).mockImplementation(async (_s, _u, _p, s) => { signal = s; return new Promise(() => {}); });
    const work = h.reviewer.run(); await vi.advanceTimersByTimeAsync(200);
    expect((await work).reason).toBe('review_failed_closed'); expect(signal?.aborted).toBe(true);
    expect(h.deps.execute).not.toHaveBeenCalled();
  });
  it('serializes simultaneous scheduler calls', async () => {
    const h = harness(); let release!: () => void;
    vi.mocked(h.deps.provider).mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); return h.result; });
    const first = h.reviewer.run(); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect((await h.reviewer.run()).reason).toBe('off_busy_or_policy'); release(); await first;
    expect(h.deps.provider).toHaveBeenCalledTimes(1); expect(h.deps.execute).toHaveBeenCalledTimes(1);
  });
});

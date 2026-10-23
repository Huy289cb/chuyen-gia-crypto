import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sealCausalPlan, type CausalPlanContract } from '../../src/utils/causal-plan-contract';

const mocks = vi.hoisted(() => ({ analyze: vi.fn() }));
vi.mock('../../src/services/groq-client', () => ({
  createGroqClient: () => ({ analyze: mocks.analyze }),
}));
import { GroqDispatchService } from '../../src/services/groq-dispatch.service';

type Review = {
  callGroqWithValidation: (system: string, user: string, context: {
    symbol: string; timeframe: string; causalPlan?: CausalPlanContract;
  }) => Promise<Record<string, unknown> | null>;
};

describe('causal selector at the actual dispatch provider boundary', () => {
  let plan: CausalPlanContract;
  let service: Review;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T04:00:00Z'));
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('CAUSAL_REVIEW_CONTRACT', 'selector-v1');
    vi.stubEnv('CAUSAL_REVIEW_RESPONSE_FORMAT', 'json_schema');
    mocks.analyze.mockReset();
    plan = sealCausalPlan({ version: 'h1-h2-review-v1', setupId: 'recorded-plan',
      mechanism: 'H2', symbol: 'BTC', timeframe: '5m', side: 'long',
      knownAt: Date.now() - 5000, expiresAt: Date.now() + 60_000,
      entry: 100, stop: 99, target: 104, invalidation: 99.5, minRr: 1.5 });
    service = new GroqDispatchService({ maxRetries: 0 }) as unknown as Review;
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  const context = (p?: CausalPlanContract) => ({ symbol: 'BTC', timeframe: '5m', causalPlan: p });
  const response = (p: CausalPlanContract, decision = 'confirm') => ({
    decision, plan_hash: p.hash, confidence: 0.73, reason: 'Reviewed the supplied candle plan.',
  });

  it('decodes the selector before generic validation and preserves prices and actual confidence', async () => {
    mocks.analyze.mockResolvedValue(response(plan));
    const actual = await service.callGroqWithValidation('system', 'user', context(plan));
    expect(actual).toMatchObject({ action: 'buy', bias: 'bullish', confidence: 0.73,
      suggested_entry: 100, suggested_stop_loss: 99, suggested_take_profit: 104,
      invalidation_level: 99.5, expected_rr: 4 });
    expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({ responseFormat: 'json_object' }));
  });
  it('retains HOLD as a veto without producing price levels', async () => {
    mocks.analyze.mockResolvedValue(response(plan, 'hold'));
    const actual = await service.callGroqWithValidation('system', 'user', context(plan));
    expect(actual).toMatchObject({ action: 'hold', bias: 'neutral', confidence: 0.73 });
    expect(actual).not.toHaveProperty('suggested_entry');
  });
  it('does not call a provider for an expired plan', async () => {
    vi.setSystemTime(plan.expiresAt);
    expect(await service.callGroqWithValidation('system', 'user', context(plan))).toBeNull();
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it('rejects expiry during the asynchronous provider request', async () => {
    mocks.analyze.mockImplementation(async () => {
      vi.setSystemTime(plan.expiresAt);
      return response(plan);
    });
    expect(await service.callGroqWithValidation('system', 'user', context(plan))).toBeNull();
    expect(mocks.analyze).toHaveBeenCalledOnce();
  });
  it('rejects an approval bound to a different plan', async () => {
    mocks.analyze.mockResolvedValue({ ...response(plan), plan_hash: 'another-plan' });
    expect(await service.callGroqWithValidation('system', 'user', context(plan))).toBeNull();
  });
  it('keeps generic percent-confidence normalization when no causal plan is supplied', async () => {
    mocks.analyze.mockResolvedValue({ btc: { bias: 'neutral', action: 'hold', confidence: 72 } });
    expect(await service.callGroqWithValidation('system', 'user', context())).toMatchObject({
      action: 'hold', confidence: 0.72,
    });
    expect(mocks.analyze.mock.calls[0][0]).not.toHaveProperty('responseFormat');
  });
  it('retains the previous causal response format and validation when selector mode is off', async () => {
    vi.stubEnv('CAUSAL_REVIEW_CONTRACT', '');
    mocks.analyze.mockResolvedValue({ bias: 'bullish', action: 'buy', confidence: 0.82,
      suggested_entry: plan.entry, suggested_stop_loss: plan.stop,
      suggested_take_profit: plan.target, invalidation_level: plan.invalidation });
    expect(await service.callGroqWithValidation('system', 'user', context(plan))).toMatchObject({
      action: 'buy', confidence: 0.82, suggested_entry: plan.entry,
    });
    expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({ responseFormat: 'json_schema' }));
  });
});

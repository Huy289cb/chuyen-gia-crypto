import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAiOpportunityPolicy } from '../../src/config/ai-opportunity-policy';
afterEach(() => vi.unstubAllEnvs());
describe('opportunity policy fingerprint and limits', () => {
  it('defaults off and fails closed for invalid modes', () => {
    vi.stubEnv('AI_OPPORTUNITY_MODE', ''); expect(getAiOpportunityPolicy().mode).toBe('off');
    vi.stubEnv('AI_OPPORTUNITY_MODE', 'LIVE'); expect(getAiOpportunityPolicy().mode).toBe('off');
  });
  it('bounds request count and timeout', () => {
    vi.stubEnv('AI_OPPORTUNITY_DAILY_REQUESTS', '999');
    vi.stubEnv('AI_OPPORTUNITY_TIMEOUT_MS', '999999');
    expect(getAiOpportunityPolicy().dailyRequests).toBe(24);
    expect(getAiOpportunityPolicy().timeoutMs).toBe(15000);
    vi.stubEnv('AI_OPPORTUNITY_TIMEOUT_MS', '-1'); expect(getAiOpportunityPolicy().timeoutMs).toBe(10000);
  });
  it('allows a bounded opportunity RR and fingerprints the selected geometry', () => {
    vi.stubEnv('AI_OPPORTUNITY_MIN_RR', '');
    const defaultPolicy = getAiOpportunityPolicy();
    expect(defaultPolicy.minRr).toBe(3);
    vi.stubEnv('AI_OPPORTUNITY_MIN_RR', '2');
    const rr2 = getAiOpportunityPolicy();
    expect(rr2.minRr).toBe(2);
    expect(rr2.hash).not.toBe(defaultPolicy.hash);
    vi.stubEnv('AI_OPPORTUNITY_MIN_RR', '0.5');
    expect(getAiOpportunityPolicy().minRr).toBe(3);
    vi.stubEnv('AI_OPPORTUNITY_MIN_RR', 'not-a-number');
    expect(getAiOpportunityPolicy().minRr).toBe(3);
  });
  it('fingerprints circuit configuration and model but allows the same reviewed hash across modes', () => {
    vi.stubEnv('AI_OPPORTUNITY_MODE', 'shadow');
    vi.stubEnv('CIRCUIT_DAILY_LOSS_ENABLED', 'true');
    const before = getAiOpportunityPolicy().hash;
    vi.stubEnv('AI_OPPORTUNITY_MODE', 'live'); expect(getAiOpportunityPolicy().hash).toBe(before);
    vi.stubEnv('CIRCUIT_DAILY_LOSS_ENABLED', 'false'); expect(getAiOpportunityPolicy().hash).not.toBe(before);
    vi.stubEnv('CIRCUIT_DAILY_LOSS_ENABLED', 'true');
    vi.stubEnv('AI_OPPORTUNITY_MODEL', 'different-model'); expect(getAiOpportunityPolicy().hash).not.toBe(before);
  });
  it('rejects fixed-dollar cap and changed owner financial limits', () => {
    vi.stubEnv('MAX_EFFECTIVE_RISK_PER_TRADE_USD', '1'); expect(getAiOpportunityPolicy().pinned).toBe(false);
    vi.stubEnv('MAX_EFFECTIVE_RISK_PER_TRADE_USD', '');
    vi.stubEnv('MAX_EFFECTIVE_RISK_PER_TRADE_PERCENT', '4'); expect(getAiOpportunityPolicy().pinned).toBe(false);
  });
});

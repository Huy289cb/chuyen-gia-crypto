import { describe, expect, it } from 'vitest';
import { resolveLlmShadowOutcome, type LlmShadowPlan } from '../../src/utils/llm-shadow-outcome';

const minute = 60_000;
const start = 1_800_000;
const plan: LlmShadowPlan = {
  eventId: 7,
  model: 'fixture',
  symbol: 'BTC',
  timeframe: '5m',
  action: 'buy',
  confidence: 0.8,
  entry: 100,
  stop: 99,
  target: 102,
  availableAt: start - 1,
  ttlMs: 3 * minute,
  maxHoldMs: 5 * minute,
};
const bar = (index: number, open: number, high: number, low: number, close: number) => ({
  openTime: start + index * minute, open, high, low, close,
});

describe('resolveLlmShadowOutcome', () => {
  it('resolves a touched limit and later target with costs', () => {
    const outcome = resolveLlmShadowOutcome({
      plan,
      bars: [
        bar(0, 101, 101.2, 100.5, 100.8),
        bar(1, 100.4, 100.6, 99.9, 100.2),
        bar(2, 100.2, 102.1, 100.1, 102),
      ],
      funding: [],
      asOf: start + 3 * minute,
    });
    expect(outcome.status).toBe('resolved');
    expect(outcome.reason).toBe('take_profit');
    expect(outcome.entryMinuteAmbiguous).toBe(false);
    expect(outcome.promotionEligible).toBe(true);
    expect(outcome.baseNetR).toBeGreaterThan(1.7);
    expect(outcome.stressNetR).toBeLessThan(outcome.baseNetR!);
  });

  it('expires when the limit is never touched', () => {
    const outcome = resolveLlmShadowOutcome({
      plan,
      bars: [
        bar(0, 101, 102, 100.5, 101),
        bar(1, 101, 102, 100.4, 101),
        bar(2, 101, 102, 100.3, 101),
      ],
      funding: [],
      asOf: start + 3 * minute,
    });
    expect(outcome.status).toBe('expired_without_fill');
    expect(outcome.baseNetUsd).toBeNull();
  });

  it('marks a fill-minute barrier touch as ineligible', () => {
    const outcome = resolveLlmShadowOutcome({
      plan: { ...plan, maxHoldMs: 2 * minute },
      bars: [
        bar(0, 100.5, 102.2, 98.8, 100),
        bar(1, 100, 102.1, 99.5, 102),
      ],
      funding: [],
      asOf: start + 2 * minute,
    });
    expect(outcome.status).toBe('resolved');
    expect(outcome.entryMinuteAmbiguous).toBe(true);
    expect(outcome.promotionEligible).toBe(false);
  });
});

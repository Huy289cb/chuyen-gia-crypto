import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isOptimizedRangeRetest,
  validateOptimizedRangeRetest,
  type RetestDispatchContext,
} from '../../src/utils/adaptive-retest-dispatch';
import type { SignalGateOutput } from '../../src/services/signal-gate.service';

function context(overrides: Partial<RetestDispatchContext> = {}): RetestDispatchContext {
  return {
    candidateKey: 'range-1',
    candidateKind: 'range_sweep_reclaim',
    side: 'long',
    boundaryPrice: 100,
    breakoutBarKey: 'bar-1',
    confirmedEntryPrice: 100.5,
    minRr: 1.5,
    ...overrides,
  };
}

function signal(): SignalGateOutput {
  return {
    pass: true,
    shouldCallGroq: true,
    isDuplicate: false,
    reason: 'range sweep',
    gateRegime: 'range',
    setupResult: {
      playbookKey: 'liquidity_sweep_reclaim',
      grade: 'B',
      confidence: 0.7,
      regime: 'range',
      reason: 'sweep',
      detailReason: 'sweep',
      evidence: { regime: { trendDirection: null } },
    },
  } as unknown as SignalGateOutput;
}

describe('optimized range retest dispatch policy', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('revalidates target room and fails closed for missing or narrow range bounds', () => {
    vi.stubEnv('V3_RANGE_SWEEP_REQUIRE_TARGET_ROOM', 'true');
    vi.stubEnv('MIN_SL_DISTANCE_PERCENT', '0.008');
    const check = (bounds: Partial<RetestDispatchContext>) => validateOptimizedRangeRetest({
      context: context(bounds), timeframe: '5m', signalResult: signal(),
      htf1h: { fresh: true, regime: 'range' }, structureBias: 'bull',
    });
    expect(check({}).pass).toBe(false);
    expect(check({rangeLow: 99, rangeHigh: 101}).pass).toBe(false);
    expect(check({rangeLow: 99, rangeHigh: 103}).pass).toBe(true);
  });
  it('accepts only the validated long-5m RR1.5 contract', () => {
    expect(isOptimizedRangeRetest(context())).toBe(true);
    expect(isOptimizedRangeRetest(context({ side: 'short' }))).toBe(false);
    expect(isOptimizedRangeRetest(context({ minRr: 2 }))).toBe(false);
  });

  it('allows bull/transition structure with fresh 1h range and A/B sweep evidence', () => {
    for (const structureBias of ['bull', 'transition'] as const) {
      expect(validateOptimizedRangeRetest({
        context: context(), timeframe: '5m', signalResult: signal(),
        htf1h: { fresh: true, regime: 'range' }, structureBias,
      }).pass).toBe(true);
    }
  });

  it('fails closed on bear structure, stale HTF, wrong TF, or wrong playbook', () => {
    expect(validateOptimizedRangeRetest({
      context: context(), timeframe: '5m', signalResult: signal(),
      htf1h: { fresh: true, regime: 'range' }, structureBias: 'bear',
    }).pass).toBe(false);
    expect(validateOptimizedRangeRetest({
      context: context(), timeframe: '5m', signalResult: signal(),
      htf1h: { fresh: false, regime: 'range' }, structureBias: 'bull',
    }).pass).toBe(false);
    expect(validateOptimizedRangeRetest({
      context: context(), timeframe: '15m', signalResult: signal(),
      htf1h: { fresh: true, regime: 'range' }, structureBias: 'bull',
    }).pass).toBe(false);
    const wrong = signal();
    wrong.setupResult.playbookKey = 'breakout_volume';
    expect(validateOptimizedRangeRetest({
      context: context(), timeframe: '5m', signalResult: wrong,
      htf1h: { fresh: true, regime: 'range' }, structureBias: 'bull',
    }).pass).toBe(false);
  });
});

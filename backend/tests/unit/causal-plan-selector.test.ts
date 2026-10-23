import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { sealCausalPlan, causalAnalysisBlock, type CausalPlanContract } from '../../src/utils/causal-plan-contract';
import { buildCausalPlanSelectorPrompt, causalPlanSelectorEnabled, decodeCausalPlanSelector } from '../../src/utils/causal-plan-selector';

function fixture(side: 'long' | 'short' = 'long'): CausalPlanContract {
  return sealCausalPlan({
    version: 'h1-h2-review-v1', setupId: `selector-${side}`,
    mechanism: side === 'long' ? 'H1' : 'H2', symbol: 'BTC',
    timeframe: side === 'long' ? '15m' : '5m', side,
    knownAt: 100, expiresAt: 1000, entry: 80000,
    stop: side === 'long' ? 79000 : 81000,
    target: side === 'long' ? 82234.5 : 77765.5,
    invalidation: side === 'long' ? 79500 : 80500,
    minRr: 1.5,
  });
}

const choice = (plan: CausalPlanContract) => ({
  decision: 'confirm', plan_hash: plan.hash, confidence: 0.83, reason: 'The supplied plan is supported.',
});
const decode = (raw: unknown, plan = fixture(), now = 500) =>
  decodeCausalPlanSelector(raw, plan, 'BTC', plan.timeframe, now);

afterEach(() => vi.unstubAllEnvs());

describe('causal selector research contract', () => {
  it('is disabled unless its exact version is explicitly selected', () => {
    for (const value of [undefined, '', 'true', 'selector-v2', ' selector-v1 ']) {
      vi.stubEnv('CAUSAL_REVIEW_CONTRACT', value);
      expect(causalPlanSelectorEnabled()).toBe(false);
    }
    vi.stubEnv('CAUSAL_REVIEW_CONTRACT', 'selector-v1');
    expect(causalPlanSelectorEnabled()).toBe(true);
  });

  it.each(['long', 'short'] as const)('confirms %s using only sealed geometry and the actual reviewer confidence', side => {
    const plan = fixture(side), before = structuredClone(plan);
    const result = decode(choice(plan), plan);
    expect(result.analysis).toEqual({
      bias: side === 'long' ? 'bullish' : 'bearish', action: side === 'long' ? 'buy' : 'sell',
      confidence: 0.83, suggested_entry: plan.entry, suggested_stop_loss: plan.stop,
      suggested_take_profit: plan.target, invalidation_level: plan.invalidation,
      expected_rr: 2.2345, reason_summary: choice(plan).reason,
    });
    expect(causalAnalysisBlock(plan, result.analysis!)).toBeNull();
    expect(plan).toEqual(before);
  });

  it.each(['long', 'short'] as const)('keeps %s HOLD a veto with no trade geometry', side => {
    const plan = fixture(side);
    const result = decode({ ...choice(plan), decision: 'hold', confidence: 0.27 }, plan);
    expect(result.analysis).toEqual({
      bias: 'neutral', action: 'hold', confidence: 0.27, reason_summary: choice(plan).reason,
    });
    expect(causalAnalysisBlock(plan, result.analysis!)).toBeNull();
  });

  it('accepts parsed plain responses across the shared-engine VM boundary', () => {
    const plan = fixture();
    const raw = runInNewContext('JSON.parse(payload)', { payload: JSON.stringify(choice(plan)) });
    expect(decode(raw, plan).analysis?.action).toBe('buy');
  });

  it('rejects the wrong plan hash even for a HOLD', () => {
    const plan = fixture();
    for (const decision of ['confirm', 'hold']) {
      expect(decode({ ...choice(plan), decision, plan_hash: 'other-plan' }, plan)).toEqual({
        analysis: null, reason: 'causal_selector_plan_hash_mismatch',
      });
    }
  });

  it('rejects mutated, wrong-scope or incorrectly sealed geometry', () => {
    const plan = fixture();
    expect(decode(choice(plan), { ...plan, target: plan.target + 1 }).reason).toBe('causal_plan_identity_changed');
    expect(decodeCausalPlanSelector(choice(plan), plan, 'ETH', plan.timeframe, 500).analysis).toBeNull();
    expect(decodeCausalPlanSelector(choice(plan), plan, 'BTC', '5m', 500).analysis).toBeNull();
    const invalid = sealCausalPlan({ ...plan, stop: 81000 });
    expect(decode(choice(invalid), invalid)).toEqual({ analysis: null, reason: 'causal_plan_geometry_invalid' });
  });

  it('checks causal validity at exact known-at and expiry boundaries', () => {
    const plan = fixture();
    expect(decode(choice(plan), plan, 100).analysis?.action).toBe('buy');
    for (const now of [99, 1000, 1001, NaN, Infinity]) {
      expect(decode(choice(plan), plan, now)).toEqual({ analysis: null, reason: 'causal_plan_expired_or_future' });
    }
  });

  it('rejects malformed, unparsed or non-plain responses without coercion', () => {
    const plan = fixture();
    for (const raw of [null, undefined, [], false, 1, '{}', JSON.stringify(choice(plan)), new Date()]) {
      expect(decode(raw, plan).analysis).toBeNull();
    }
    for (const decision of [null, 'buy', 'take', 'CONFIRM', 1]) {
      expect(decode({ ...choice(plan), decision }, plan).reason).toBe('causal_selector_decision_invalid');
    }
  });

  it('never invents or coerces a confidence number', () => {
    const plan = fixture();
    for (const confidence of [NaN, Infinity, -Infinity, -0.01, 1.01, 83, '0.83', null, undefined]) {
      expect(decode({ ...choice(plan), confidence }, plan)).toEqual({
        analysis: null, reason: 'causal_selector_confidence_invalid',
      });
    }
    for (const confidence of [0, 1]) {
      expect(decode({ ...choice(plan), confidence }, plan).analysis?.confidence).toBe(confidence);
    }
  });

  it('requires a nonempty reviewer explanation and exactly the registered keys', () => {
    const plan = fixture();
    for (const reason of ['', '  \n', null, 1]) {
      expect(decode({ ...choice(plan), reason }, plan).reason).toBe('causal_selector_reason_invalid');
    }
    for (const extra of [{ suggested_entry: 80001 }, { stop: 79000 }, { target: 82234.5 },
      { invalidation_level: 79500 }, { action: 'buy' }, { tools: [] }]) {
      expect(decode({ ...choice(plan), ...extra }, plan).reason).toBe('causal_selector_keys_invalid');
    }
    const { reason: _reason, ...missingReason } = choice(plan);
    expect(decode(missingReason, plan).reason).toBe('causal_selector_keys_invalid');
  });

  it('finishes the prompt with a selector-only contract for the exact plan', () => {
    const plan = fixture(), prompt = buildCausalPlanSelectorPrompt(plan);
    expect(prompt).toContain(JSON.stringify(plan));
    expect(prompt).toContain('This replaces every earlier output format');
    expect(prompt).toContain('"plan_hash":"' + plan.hash + '"');
    expect(prompt).toContain('do not copy the example value or the deterministic setup score');
    expect(prompt).toContain('Do not return entry, stop, target, invalidation, action, bias');
  });
});

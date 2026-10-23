import { describe, it, expect } from 'vitest';
import { buildOpportunitySnapshot, buildResearchOpportunitySnapshot, opportunityPlanBlock, parseOpportunityChoice, validOpportunityCandles } from '../../src/utils/ai-opportunity';
import { opportunityFixture } from '../fixtures/ai-opportunity';

describe('AI opportunity deterministic plans', () => {
  it('isolates research fingerprints and chooses the nearest of all confirmed targets', () => {
    const f=opportunityFixture();
    for(const b of f.candles['4h']){b.open=80500;b.close=80500;b.high=80505;b.low=80495;}
    f.candles['4h'][75].high=81000;f.candles['4h'][88].high=90000;f.candles['4h'][96].high=94000;
    const baseline=buildOpportunitySnapshot({...f,asOf:f.now});
    const research=buildResearchOpportunitySnapshot({...f,asOf:f.now});
    expect(baseline?.plans.length).toBeGreaterThan(0);
    expect(research?.policyHash).not.toBe(f.policy.hash);
    expect(research?.plans.length).toBe(0); // Older nearer pivot must block, not choose farther90k.
    expect(f.policy.mode).toBe('shadow');
  });
  it('diagnostics do not alter plans and account for each confirmed candidate', () => {
    const f = opportunityFixture(), diagnostics: Record<string, number> = {};
    const plain = buildOpportunitySnapshot({ ...f, asOf:f.now });
    const traced = buildOpportunitySnapshot({ ...f, asOf:f.now, diagnostics });
    expect(traced).toEqual(plain);
    expect(diagnostics.snapshots).toBe(1);
    expect(diagnostics['ema_retest_confirmed:candidate']).toBe(1);
    expect(diagnostics['ema_retest_confirmed:accepted']).toBe(1);
    const blocked: Record<string, number> = {};
    buildOpportunitySnapshot({ ...f, asOf:f.now, finance:{...f.finance,balance:1},diagnostics:blocked });
    expect(blocked['ema_retest_confirmed:risk_budget']).toBe(1);
    expect(blocked['ema_retest_confirmed:accepted']).toBeUndefined();
  });
  it('requires confirmed pullback and bounds price/quantity/risk', () => {
    const f = opportunityFixture();
    expect(f.plan.setup).toBe('ema_retest_confirmed');
    expect(f.plan.rr).toBeGreaterThanOrEqual(3);
    expect(f.plan.takeProfit).toBeLessThanOrEqual(f.plan.targetBound);
    expect(f.plan.stopLoss).toBeLessThanOrEqual(f.plan.invalidation);
    expect(opportunityPlanBlock(f.plan, f.finance, f.policy, f.now)).toBeNull();
  });
  it.each(['long', 'short'] as const)('detects a confirmed breakout retest %s and requires breakout volume', side => {
    const f = opportunityFixture();
    Object.assign(f.candles['15m'][98], { open: 79960, close: 80100, high: 80110, low: 79950, volume: 200 });
    Object.assign(f.candles['15m'][99], { open: 79960, close: 80060, high: 80070, low: 79930 });
    if (side === 'short') {
      for (const rows of Object.values(f.candles)) for (const b of rows) {
        const high = b.high;
        b.open = 160000 - b.open; b.close = 160000 - b.close;
        b.high = 160000 - b.low; b.low = 160000 - high;
      }
      f.finance.fundingRate *= -1;
    }
    const built = buildOpportunitySnapshot({ ...f, asOf: f.now });
    const plan = built?.plans.find(p => p.setup === 'breakout_retest_confirmed');
    expect(plan?.side).toBe(side);
    expect(opportunityPlanBlock(plan!, f.finance, f.policy, f.now)).toBeNull();
    f.candles['15m'][98].volume = 100;
    expect(buildOpportunitySnapshot({ ...f, asOf: f.now })?.plans.some(p => p.setup === 'breakout_retest_confirmed')).toBe(false);
  });
  it('builds symmetric short EMA plans', () => {
    const f = opportunityFixture();
    for (const rows of Object.values(f.candles)) for (const b of rows) {
      const high = b.high;
      b.open = 160000 - b.open; b.close = 160000 - b.close;
      b.high = 160000 - b.low; b.low = 160000 - high;
    }
    const p = buildOpportunitySnapshot({ ...f, asOf: f.now })?.plans[0];
    expect(p?.side).toBe('short');
    expect(opportunityPlanBlock(p!, f.finance, f.policy, f.now)).toBeNull();
  });
  it('does not create a trade just from touching EMA', () => {
    const f = opportunityFixture();
    f.candles['15m'][99].close = 79970;
    expect(buildOpportunitySnapshot({ asOf: f.now, ...f })?.plans.length).toBe(0);
  });
  it.each(['5m', '15m', '1h', '4h'] as const)('rejects future candles, gaps and invalid OHLC on %s', tf => {
    const f = opportunityFixture(), rows = structuredClone(f.candles[tf]);
    expect(validOpportunityCandles(rows, tf, f.now)).toBe(true);
    rows[99].timestamp = f.now;
    expect(validOpportunityCandles(rows, tf, f.now)).toBe(false);
    rows[99] = { ...f.candles[tf][99] }; rows[40].timestamp += 1;
    expect(validOpportunityCandles(rows, tf, f.now)).toBe(false);
    rows[40] = { ...f.candles[tf][40] }; rows[99].high = rows[99].close - 1;
    expect(validOpportunityCandles(rows, tf, f.now)).toBe(false);
  });
  it('does not push TP through the nearest structural target', () => {
    const f = opportunityFixture();
    const p = { ...f.plan, targetBound: f.plan.entry + 100 };
    expect(opportunityPlanBlock(p, f.finance, f.policy, f.now)).toBe('structural_bounds');
  });
  it.each([
    ['balance', 1], ['remainingDailyRiskUsd', 0], ['remainingExposureUsd', 1], ['remainingDailyRiskUsd', NaN],
  ] as const)('blocks changed financial state %s', (key, value) => {
    const f = opportunityFixture();
    expect(opportunityPlanBlock(f.plan, { ...f.finance, [key]: value }, f.policy, f.now)).not.toBeNull();
  });
  it('blocks funding, expired plans, off-contract scope and quantity step violations', () => {
    const f = opportunityFixture();
    expect(opportunityPlanBlock(f.plan, { ...f.finance, fundingRate: .001 }, f.policy, f.now)).toBe('funding');
    expect(opportunityPlanBlock(f.plan, f.finance, f.policy, f.plan.expiresAt)).toBe('expired');
    expect(opportunityPlanBlock({ ...f.plan, quantity: .0011 }, f.finance, f.policy, f.now)).toBe('quantity');
    expect(opportunityPlanBlock(f.plan, f.finance, { ...f.policy, pinned: false }, f.now)).toBe('account_or_policy_blocked');
  });
});

describe('strict AI choice contract', () => {
  const raw = (id: string) => ({ decision: 'take', plan_id: id, reason_codes: ['confirmed_retest'], evidence_ids: ['trend1h'], missing_confirmation: null });
  it('accepts only an existing plan and existing evidence', () => {
    const f = opportunityFixture();
    expect(parseOpportunityChoice(JSON.stringify(raw(f.plan.id)), f.snapshot)?.decision).toBe('take');
    expect(parseOpportunityChoice(JSON.stringify(raw('invented')), f.snapshot)).toBeNull();
    expect(parseOpportunityChoice(JSON.stringify({ ...raw(f.plan.id), evidence_ids: ['invented'] }), f.snapshot)).toBeNull();
  });
  it.each([{ entry: 1 }, { stopLoss: 1 }, { confidence: 1 }, { tools: ['trade'] }])('rejects extra model instructions %o', extra => {
    const f = opportunityFixture();
    expect(parseOpportunityChoice(JSON.stringify({ ...raw(f.plan.id), ...extra }), f.snapshot)).toBeNull();
  });
  it('fails closed for malformed, fenced, missing, ambiguous decisions and wait with a plan', () => {
    const f = opportunityFixture();
    for (const x of ['{}', 'null', '[]', '```json {} ```', 'x'.repeat(8193), JSON.stringify({ ...raw(f.plan.id), decision: 'wait' }),
      JSON.stringify({ ...raw(f.plan.id), missing_confirmation: 'still waiting' })]) {
      expect(parseOpportunityChoice(x, f.snapshot)).toBeNull();
    }
  });
});

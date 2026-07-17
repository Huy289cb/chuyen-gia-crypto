import { describe, expect, it } from 'vitest';
import { computeProfitProtectSl } from '../../src/utils/profit-protect-sl';

const base = {
  side: 'long' as const,
  entry: 63703.6,
  mark: 63703.6,
  currentSl: 62922.41,
  initialRisk: 63703.6 - 62922.41,
  ageMinutes: 60,
  beAtR: 1,
  trailActivatePct: 1.5,
  trailDistancePct: 0.8,
  minSlMovePct: 0.05,
  minAgeMinutes: 15,
  timeStopHours: 24,
};

describe('computeProfitProtectSl', () => {
  it('does nothing when flat / young', () => {
    const out = computeProfitProtectSl({ ...base, ageMinutes: 5, mark: 64000 });
    expect(out.action).toBe('none');
    expect(out.reason).toContain('age');
  });

  it('moves to breakeven at >= 1R', () => {
    // 1R ≈ +781 → mark ≈ 64485
    const mark = base.entry + base.initialRisk;
    const out = computeProfitProtectSl({ ...base, mark });
    expect(out.action).toBe('breakeven');
    expect(out.newSl).toBe(63703.6);
    expect(out.rMultiple).toBeGreaterThanOrEqual(1);
  });

  it('trails behind mark after +1.5%', () => {
    const mark = base.entry * 1.0286; // ~+2.86% peak case
    const out = computeProfitProtectSl({ ...base, mark, currentSl: base.entry });
    expect(out.action).toBe('trail');
    const expected = Math.round(mark * (1 - 0.008) * 100) / 100;
    expect(out.newSl).toBe(expected);
    expect(out.newSl).toBeGreaterThan(base.entry);
  });

  it('time-stop BE after 24h when green but below 1R', () => {
    const mark = base.entry * 1.005; // +0.5%, below 1R (~1.23%)
    const out = computeProfitProtectSl({
      ...base,
      mark,
      ageMinutes: 25 * 60,
    });
    expect(out.action).toBe('time_stop_be');
    expect(out.newSl).toBe(base.entry);
  });

  it('short: trail above mark', () => {
    const entry = 62871;
    const currentSl = 63374;
    const mark = entry * 0.98; // +2% for short
    const out = computeProfitProtectSl({
      ...base,
      side: 'short',
      entry,
      currentSl,
      initialRisk: currentSl - entry,
      mark,
    });
    expect(out.action).toBe('trail');
    expect(out.newSl).toBeLessThan(currentSl);
    expect(out.newSl).toBeGreaterThan(mark);
  });

  it('does not loosen SL', () => {
    const mark = base.entry * 1.02;
    const tightSl = Math.round(mark * (1 - 0.008) * 100) / 100;
    const out = computeProfitProtectSl({
      ...base,
      mark,
      currentSl: tightSl,
    });
    expect(out.action).toBe('none');
  });
});

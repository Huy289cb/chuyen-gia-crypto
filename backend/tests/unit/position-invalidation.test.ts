import { describe, expect, it } from 'vitest';
import { evaluatePositionInvalidation } from '../../src/utils/position-invalidation';

const base = {
  side: 'long' as const,
  entry: 63703.6,
  mark: 64000,
  currentSl: 62922.41,
  ageMinutes: 120,
  initialRisk: 63703.6 - 62922.41,
  minScore: 2,
  minAgeMinutes: 30,
  minUpnlPct: 0.15,
  htfLostMinHours: 6,
};

describe('evaluatePositionInvalidation', () => {
  it('holds when young', () => {
    const out = evaluatePositionInvalidation({ ...base, ageMinutes: 10 });
    expect(out.action).toBe('hold');
    expect(out.reason).toContain('age');
  });

  it('holds with no signals', () => {
    const out = evaluatePositionInvalidation({
      ...base,
      htf: { timeframe: '1h', regime: 'trend', trendDirection: 'bullish' },
    });
    expect(out.action).toBe('hold');
    expect(out.score).toBe(0);
  });

  it('tightens BE on HTF chop when green', () => {
    const out = evaluatePositionInvalidation({
      ...base,
      htf: { timeframe: '1h', regime: 'chop', trendDirection: null },
    });
    expect(out.action).toBe('tighten_be');
    expect(out.score).toBe(2);
    expect(out.newSl).toBe(63703.6);
    expect(out.signals.some((s) => s.id === 'htf_chop')).toBe(true);
  });

  it('tightens BE on trend against', () => {
    const out = evaluatePositionInvalidation({
      ...base,
      htf: { timeframe: '1h', regime: 'trend', trendDirection: 'bearish' },
    });
    expect(out.action).toBe('tighten_be');
    expect(out.signals.some((s) => s.id === 'htf_trend_against')).toBe(true);
  });

  it('logs only when score high but red', () => {
    const out = evaluatePositionInvalidation({
      ...base,
      mark: 63000, // red long
      htf: { timeframe: '1h', regime: 'chop' },
    });
    expect(out.action).toBe('hold');
    expect(out.score).toBe(2);
    expect(out.reason).toContain('log only');
  });

  it('fires adverse high-sweep for long', () => {
    const out = evaluatePositionInvalidation({
      ...base,
      htf: {
        timeframe: '1h',
        regime: 'trend',
        trendDirection: 'bullish',
        playbooks: [
          {
            playbook: 'liquidity_sweep',
            detected: true,
            grade: 'A',
            metrics: { highSweep: true, lowSweep: false },
          },
        ],
      },
    });
    expect(out.action).toBe('tighten_be');
    expect(out.signals.some((s) => s.id === 'adverse_sweep')).toBe(true);
  });

  it('ignores favorable low-sweep for long', () => {
    const out = evaluatePositionInvalidation({
      ...base,
      htf: {
        timeframe: '1h',
        regime: 'trend',
        trendDirection: 'bullish',
        playbooks: [
          {
            playbook: 'liquidity_sweep',
            detected: true,
            grade: 'A',
            metrics: { highSweep: false, lowSweep: true },
          },
        ],
      },
    });
    expect(out.action).toBe('hold');
    expect(out.score).toBe(0);
  });

  it('holds when SL already at/above BE', () => {
    const out = evaluatePositionInvalidation({
      ...base,
      currentSl: 63703.6,
      htf: { timeframe: '1h', regime: 'chop' },
    });
    expect(out.action).toBe('hold');
    expect(out.reason).toContain('already');
  });

  it('short: bullish HTF → against', () => {
    const out = evaluatePositionInvalidation({
      ...base,
      side: 'short',
      mark: 63000,
      currentSl: 64500,
      htf: { timeframe: '1h', regime: 'trend', trendDirection: 'bullish' },
    });
    expect(out.action).toBe('tighten_be');
    expect(out.newSl).toBe(63703.6);
  });
});

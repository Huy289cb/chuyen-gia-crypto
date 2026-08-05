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
  beFeeBufferPct: 0.08,
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

  it('exits on HTF chop when score≥min and allowExit', () => {
    const out = evaluatePositionInvalidation({
      ...base,
      htf: { timeframe: '1h', regime: 'chop', trendDirection: null },
      allowExitWhenRed: true,
    });
    expect(out.action).toBe('exit');
    expect(out.score).toBe(2);
    expect(out.reason).toContain('invalidation exit');
    expect(out.signals.some((s) => s.id === 'htf_chop')).toBe(true);
  });

  it('exits on trend against when allowExit (green or red)', () => {
    const out = evaluatePositionInvalidation({
      ...base,
      htf: { timeframe: '1h', regime: 'trend', trendDirection: 'bearish' },
      allowExitWhenRed: true,
    });
    expect(out.action).toBe('exit');
    expect(out.signals.some((s) => s.id === 'htf_trend_against')).toBe(true);
  });

  it('exits when score high and red if allowExitWhenRed', () => {
    const out = evaluatePositionInvalidation({
      ...base,
      mark: 63000, // red long
      htf: { timeframe: '1h', regime: 'chop' },
      allowExitWhenRed: true,
    });
    expect(out.action).toBe('exit');
    expect(out.score).toBe(2);
    expect(out.reason).toContain('invalidation exit');
  });

  it('logs only when score high but exit disabled', () => {
    const out = evaluatePositionInvalidation({
      ...base,
      mark: 63000, // red long
      htf: { timeframe: '1h', regime: 'chop' },
    });
    expect(out.action).toBe('hold');
    expect(out.score).toBe(2);
    expect(out.reason).toContain('exit disabled');
  });

  it('barely green + allowExit → exit (no BE path)', () => {
    const out = evaluatePositionInvalidation({
      ...base,
      mark: 63710, // ~+0.01%
      htf: { timeframe: '1h', regime: 'chop' },
      allowExitWhenRed: true,
    });
    expect(out.action).toBe('exit');
    expect(out.reason).toContain('invalidation exit');
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
      allowExitWhenRed: true,
    });
    expect(out.action).toBe('exit');
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

  it('short: bullish HTF → exit when allowExit', () => {
    const out = evaluatePositionInvalidation({
      ...base,
      side: 'short',
      mark: 63000,
      currentSl: 64500,
      htf: { timeframe: '1h', regime: 'trend', trendDirection: 'bullish' },
      allowExitWhenRed: true,
    });
    expect(out.action).toBe('exit');
    expect(out.signals.some((s) => s.id === 'htf_trend_against')).toBe(true);
  });

  it('never returns tighten_be', () => {
    const out = evaluatePositionInvalidation({
      ...base,
      htf: { timeframe: '1h', regime: 'chop' },
      allowExitWhenRed: true,
    });
    expect(out.action).not.toBe('tighten_be' as 'hold');
    expect(out.action).toBe('exit');
  });
});

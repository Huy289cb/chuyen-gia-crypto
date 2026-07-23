import { describe, expect, it, afterEach } from 'vitest';
import {
  evaluateHtfTrendRequirement,
  evaluateHtfSideAlign,
  getV3HtfTrendAlt,
  isRangeEntryBlocked,
  isV3HtfFlexLtfOnly,
  resolveGateRegimeFromSignal,
} from '../../src/config/v3-entry-policy';

describe('v3-entry-policy gate regime', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('resolveGateRegimeFromSignal prefers gateRegime over LTF regime', () => {
    expect(
      resolveGateRegimeFromSignal({
        gateRegime: 'trend',
        setupResult: { regime: 'range' },
      })
    ).toBe('trend');
  });

  it('isRangeEntryBlocked uses effective gate regime (breakout bypass path)', () => {
    process.env.V3_BLOCK_RANGE_ENTRIES = 'true';
    const effective = resolveGateRegimeFromSignal({
      gateRegime: 'trend',
      setupResult: { regime: 'range' },
    });
    expect(isRangeEntryBlocked(effective)).toBe(false);
    expect(isRangeEntryBlocked('range')).toBe(true);
  });

  it('isRangeEntryBlocked off when V3_BLOCK_RANGE_ENTRIES=false', () => {
    process.env.V3_BLOCK_RANGE_ENTRIES = 'false';
    expect(isRangeEntryBlocked('range')).toBe(false);
  });
});

describe('evaluateHtfTrendRequirement', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('passes when primary HTF is trend', () => {
    const r = evaluateHtfTrendRequirement({
      entryTimeframe: '5m',
      primaryTf: '1h',
      primaryRegime: 'trend',
      altTf: '15m',
      altRegime: 'range',
    });
    expect(r.pass).toBe(true);
  });

  it('passes 5m when primary range but alt 15m trend (flex LTF)', () => {
    process.env.V3_HTF_FLEX_LTF_ONLY = 'true';
    const r = evaluateHtfTrendRequirement({
      entryTimeframe: '5m',
      primaryTf: '1h',
      primaryRegime: 'range',
      altTf: '15m',
      altRegime: 'trend',
    });
    expect(r.pass).toBe(true);
    expect(r.reason).toContain('V3_HTF_TREND_ALT');
  });

  it('blocks 1h entry when primary range even if alt 15m trend (flex LTF only)', () => {
    process.env.V3_HTF_FLEX_LTF_ONLY = 'true';
    const r = evaluateHtfTrendRequirement({
      entryTimeframe: '1h',
      primaryTf: '1h',
      primaryRegime: 'range',
      altTf: '15m',
      altRegime: 'trend',
    });
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('requires primary HTF trend');
  });

  it('blocks when both primary and alt are not trend', () => {
    const r = evaluateHtfTrendRequirement({
      entryTimeframe: '15m',
      primaryTf: '1h',
      primaryRegime: 'range',
      altTf: '15m',
      altRegime: 'range',
    });
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('V3_REQUIRE_HTF_TREND');
  });

  it('getV3HtfTrendAlt reads env', () => {
    process.env.V3_HTF_TREND_ALT = '15m';
    expect(getV3HtfTrendAlt()).toBe('15m');
    process.env.V3_HTF_TREND_ALT = 'false';
    expect(getV3HtfTrendAlt()).toBeNull();
  });

  it('isV3HtfFlexLtfOnly defaults true', () => {
    delete process.env.V3_HTF_FLEX_LTF_ONLY;
    expect(isV3HtfFlexLtfOnly()).toBe(true);
    process.env.V3_HTF_FLEX_LTF_ONLY = 'false';
    expect(isV3HtfFlexLtfOnly()).toBe(false);
  });
});

describe('evaluateHtfSideAlign', () => {
  it('blocks long against bearish 1h trend', () => {
    const r = evaluateHtfSideAlign({
      side: 'long',
      htfTf: '1h',
      htf: { regime: 'trend', trendDirection: 'bearish' },
      enabled: true,
    });
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('against');
  });

  it('allows short against bearish 1h (aligned)', () => {
    const r = evaluateHtfSideAlign({
      side: 'short',
      htfTf: '1h',
      htf: { regime: 'trend', trendDirection: 'bearish' },
      enabled: true,
    });
    expect(r.pass).toBe(true);
  });

  it('passes when HTF not in trend', () => {
    const r = evaluateHtfSideAlign({
      side: 'long',
      htfTf: '1h',
      htf: { regime: 'chop', trendDirection: null },
      enabled: true,
    });
    expect(r.pass).toBe(true);
  });
});

import { describe, expect, it, afterEach } from 'vitest';
import {
  evaluateHtfTrendRequirement,
  evaluateHtfSideAlign,
  evaluateEntryExtension,
  evaluateTrendPullbackEntry,
  smaFromCloses,
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

describe('evaluateEntryExtension', () => {
  it('blocks long FOMO far above range low', () => {
    const r = evaluateEntryExtension({
      side: 'long',
      entry: 65350,
      rangeHigh: 65722,
      rangeLow: 64350,
      maxExtensionPct: 0.8,
      enabled: true,
      tfLabel: '12×1h',
    });
    expect(r.pass).toBe(false);
    expect(r.extensionPct).toBeGreaterThan(0.8);
    expect(r.reason).toContain('extension');
  });

  it('allows long near range low', () => {
    const r = evaluateEntryExtension({
      side: 'long',
      entry: 64400,
      rangeHigh: 65000,
      rangeLow: 64350,
      maxExtensionPct: 0.8,
      enabled: true,
    });
    expect(r.pass).toBe(true);
  });

  it('blocks short FOMO far below range high', () => {
    const r = evaluateEntryExtension({
      side: 'short',
      entry: 64000,
      rangeHigh: 65000,
      rangeLow: 63800,
      maxExtensionPct: 0.8,
      enabled: true,
    });
    expect(r.pass).toBe(false);
  });
});

describe('evaluateTrendPullbackEntry', () => {
  const flatCloses = Array.from({ length: 20 }, () => 64000);

  it('smaFromCloses averages last period', () => {
    expect(smaFromCloses([1, 2, 3, 4, 5], 3)).toBe(4);
    expect(smaFromCloses([1, 2], 3)).toBeNull();
  });

  it('allows long at SMA', () => {
    const r = evaluateTrendPullbackEntry({
      side: 'long',
      entry: 64000,
      closes: flatCloses,
      enabled: true,
    });
    expect(r.pass).toBe(true);
    expect(r.sma).toBe(64000);
    expect(Math.abs(r.distPct ?? 99)).toBeLessThan(0.01);
  });

  it('blocks long too far above SMA (chase)', () => {
    const r = evaluateTrendPullbackEntry({
      side: 'long',
      entry: 64500,
      closes: flatCloses,
      maxAbovePct: 0.25,
      maxBelowPct: 1.0,
      enabled: true,
    });
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('above');
    expect(r.reason).toContain('V3_REQUIRE_PULLBACK');
  });

  it('allows long modest dip below SMA', () => {
    const r = evaluateTrendPullbackEntry({
      side: 'long',
      entry: 63600, // ~0.63% below 64000
      closes: flatCloses,
      maxAbovePct: 0.25,
      maxBelowPct: 1.0,
      enabled: true,
    });
    expect(r.pass).toBe(true);
  });

  it('blocks long too deep below SMA', () => {
    const r = evaluateTrendPullbackEntry({
      side: 'long',
      entry: 63000, // ~1.6% below
      closes: flatCloses,
      maxAbovePct: 0.25,
      maxBelowPct: 1.0,
      enabled: true,
    });
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('below');
  });

  it('blocks short too far below SMA (chase dump)', () => {
    const r = evaluateTrendPullbackEntry({
      side: 'short',
      entry: 63000,
      closes: flatCloses,
      maxAbovePct: 0.25,
      maxBelowPct: 1.0,
      enabled: true,
    });
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('below');
  });

  it('allows short near/above SMA', () => {
    const r = evaluateTrendPullbackEntry({
      side: 'short',
      entry: 64200, // ~0.31% above — within maxBelow 1%
      closes: flatCloses,
      maxAbovePct: 0.25,
      maxBelowPct: 1.0,
      enabled: true,
    });
    expect(r.pass).toBe(true);
  });

  it('passes through when disabled', () => {
    const r = evaluateTrendPullbackEntry({
      side: 'long',
      entry: 70000,
      closes: flatCloses,
      enabled: false,
    });
    expect(r.pass).toBe(true);
  });

  /** Effectiveness fixtures from Jul 27–29 live FOMO / near-value cases. */
  it('blocks historical FOMO long ~1.5% above flat SMA (chase)', () => {
    const sma = 63600;
    const closes = Array.from({ length: 20 }, () => sma);
    const r = evaluateTrendPullbackEntry({
      side: 'long',
      entry: 64560, // ~1.5% above — Jul29 09:46 style
      closes,
      maxAbovePct: 0.25,
      maxBelowPct: 1.0,
      enabled: true,
    });
    expect(r.pass).toBe(false);
  });

  it('allows pullback long ~0.5% below SMA (dip buy)', () => {
    const sma = 64000;
    const closes = Array.from({ length: 20 }, () => sma);
    const r = evaluateTrendPullbackEntry({
      side: 'long',
      entry: 63680, // ~0.5% below
      closes,
      maxAbovePct: 0.25,
      maxBelowPct: 1.0,
      enabled: true,
    });
    expect(r.pass).toBe(true);
  });

  it('blocks short dump ~1.5% below SMA', () => {
    const sma = 64000;
    const closes = Array.from({ length: 20 }, () => sma);
    const r = evaluateTrendPullbackEntry({
      side: 'short',
      entry: 63050,
      closes,
      maxAbovePct: 0.25,
      maxBelowPct: 1.0,
      enabled: true,
    });
    expect(r.pass).toBe(false);
  });
});

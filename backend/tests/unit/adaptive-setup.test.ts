import { describe, expect, it } from 'vitest';

import {
  detectAdaptiveSetup,
  hasMicroBos,
  retestCandleRejects,
  type AdaptiveHtfState,
} from '../../src/utils/adaptive-setup';

const microBull = [
  { high: 10, low: 8, close: 9 },
  { high: 12, low: 9, close: 10 },
  { high: 10, low: 8, close: 9 },
  { high: 13, low: 10, close: 13 },
];

function htf(
  regime: AdaptiveHtfState['regime'],
  trendDirection: AdaptiveHtfState['trendDirection'],
  candles = microBull
): AdaptiveHtfState {
  return { fresh: true, regime, trendDirection, candles };
}

function rangeCandles() {
  return Array.from({ length: 24 }, (_, index) => ({
    high: index % 2 ? 110 : 108,
    low: index % 2 ? 92 : 90,
    close: 100,
  }));
}

describe('adaptive setup detector', () => {
  it('detects an early long flip only after breaking the old bearish swing extreme', () => {
    const common = {
      side: 'long' as const,
      timeframe: '15m',
      playbook: 'breakout_volume',
      grade: 'B',
      boundary: 109,
      structureBias: 'bear' as const,
      structureDetail: {
        bias: 'bear' as const,
        swingHighs: [110, 100],
        swingLows: [95, 90],
        reason: 'LH+LL',
      },
      htf1h: htf('trend', 'bullish'),
      htf15m: htf('trend', 'bullish'),
    };

    expect(detectAdaptiveSetup({ ...common, close: 109.9 })).toBeNull();
    expect(detectAdaptiveSetup({ ...common, close: 111 })).toMatchObject({
      kind: 'early_structure_flip',
      boundary: 110,
      evidence: { old_structure_bias: 'bear', broken_4h_swing: 110 },
    });
  });

  it('detects a 5m micro-BOS in the established 4h direction without requiring 1h trend', () => {
    expect(hasMicroBos('long', microBull, 1)).toEqual({ pass: true, level: 12 });
    expect(detectAdaptiveSetup({
      side: 'long',
      timeframe: '5m',
      playbook: 'breakout_volume',
      grade: 'A',
      close: 101,
      boundary: 100,
      structureBias: 'bull',
      structureDetail: null,
      htf1h: htf('range', null),
      htf15m: htf('range', null),
    })).toMatchObject({ kind: 'aligned_micro_bos', boundary: 100 });
  });

  it('rejects the micro-BOS when 1h actively opposes the trade', () => {
    expect(detectAdaptiveSetup({
      side: 'long',
      timeframe: '5m',
      playbook: 'breakout_volume',
      grade: 'A',
      close: 101,
      boundary: 100,
      structureBias: 'bull',
      structureDetail: null,
      htf1h: htf('trend', 'bearish'),
      htf15m: htf('trend', 'bullish'),
    })).toBeNull();
  });

  it('can require a fully aligned 1h trend for the optimized micro policy', () => {
    const common = {
      side: 'long' as const, timeframe: '5m', playbook: 'breakout_volume', grade: 'A',
      close: 101, boundary: 100, structureBias: 'bull' as const, structureDetail: null,
      htf15m: htf('range', null), microRequire1hAlign: true,
    };
    expect(detectAdaptiveSetup({ ...common, htf1h: htf('range', null) })).toBeNull();
    expect(detectAdaptiveSetup({ ...common, htf1h: htf('trend', 'bullish') })).toMatchObject({
      kind: 'aligned_micro_bos',
    });
  });

  it('detects a range-edge liquidity sweep reclaim but rejects the middle of range', () => {
    const common = {
      side: 'long' as const,
      timeframe: '15m',
      playbook: 'liquidity_sweep_reclaim',
      grade: 'B',
      boundary: null,
      structureBias: 'transition' as const,
      structureDetail: null,
      htf1h: htf('range', null, rangeCandles()),
      htf15m: htf('range', null),
      selectedMetrics: { priorLow19: 91 },
      rangeEdgeFraction: 0.3,
    };
    expect(detectAdaptiveSetup({ ...common, close: 92 })).toMatchObject({
      kind: 'range_sweep_reclaim',
      boundary: 91,
    });
    expect(detectAdaptiveSetup({ ...common, close: 100 })).toBeNull();
  });

  it('can restrict the optimized range policy to long 5m only', () => {
    const base = {
      timeframe: '5m', playbook: 'liquidity_sweep_reclaim', grade: 'A', close: 92,
      boundary: null, structureBias: 'transition' as const, structureDetail: null,
      htf1h: htf('range', null, rangeCandles()), htf15m: htf('range', null),
      selectedMetrics: { priorLow19: 91, priorHigh19: 109 }, rangeLong5mOnly: true,
    };
    expect(detectAdaptiveSetup({ ...base, side: 'long' })).toMatchObject({
      kind: 'range_sweep_reclaim',
    });
    expect(detectAdaptiveSetup({ ...base, side: 'short', close: 108 })).toBeNull();
    expect(detectAdaptiveSetup({ ...base, side: 'long', timeframe: '15m' })).toBeNull();
  });

  it('requires B-or-better and a directional retest candle', () => {
    expect(retestCandleRejects('long', { open: 100, high: 102, low: 99, close: 101 })).toBe(true);
    expect(retestCandleRejects('long', { open: 101, high: 102, low: 99, close: 100 })).toBe(false);
    expect(detectAdaptiveSetup({
      side: 'long', timeframe: '5m', playbook: 'breakout_volume', grade: 'C', close: 101,
      boundary: 100, structureBias: 'bull', structureDetail: null,
      htf1h: htf('range', null), htf15m: htf('trend', 'bullish'),
    })).toBeNull();
  });
});

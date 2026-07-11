import { describe, expect, it } from 'vitest';

import {
  mergeDuplicateScanWithPriorEligible,
  type MarketScanResult,
} from '../../src/schedulers/market-scan.scheduler';
import type { SignalGateOutput } from '../../src/services/signal-gate.service';

function candles(lastTimestamp: number) {
  return [
    { timestamp: lastTimestamp - 300_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 },
    { timestamp: lastTimestamp, open: 1.5, high: 2, low: 1, close: 1.8, volume: 120 },
  ];
}

function signal(partial: Partial<SignalGateOutput>): SignalGateOutput {
  return {
    pass: true,
    shouldCallGroq: true,
    isDuplicate: false,
    reason: 'pass',
    setupResult: {
      grade: 'A',
      confidence: 0.9,
      regime: 'range',
      playbookKey: 'breakout_volume',
      direction: 'long',
      setupType: 'breakout',
      summary: 'test setup',
      evidence: {
        regime: {
          regime: 'range',
          volatilityPct: 0.1,
          trendStrengthPct: 0.1,
          rangeWidthPct: 1,
          trendDirection: 'bullish',
          reason: 'test',
        },
        details: [],
      },
    },
    ...partial,
  };
}

function result(signalResult: SignalGateOutput): MarketScanResult {
  return {
    symbol: 'SOL',
    timeframe: '5m',
    candles: candles(1_000_000),
    signalResult,
    timestamp: new Date('2026-07-11T13:35:00Z'),
  };
}

describe('mergeDuplicateScanWithPriorEligible', () => {
  it('keeps prior fresh pass for duplicate scans on the same bar', () => {
    const prev = result(signal({ reason: 'fresh pass' }));
    const incoming = result(
      signal({
        isDuplicate: true,
        shouldCallGroq: false,
        reason: 'Duplicate signal - using cached result',
      })
    );

    const merged = mergeDuplicateScanWithPriorEligible(prev, incoming);

    expect(merged.signalResult.reason).toBe('fresh pass');
    expect(merged.signalResult.shouldCallGroq).toBe(true);
  });

  it('does not revive a prior pass when symbol policy blocks the incoming playbook', () => {
    const prev = result(signal({ reason: 'fresh breakout pass' }));
    const incoming = result(
      signal({
        pass: false,
        shouldCallGroq: false,
        isDuplicate: true,
        reason: 'Symbol policy blocked playbook breakout_volume',
      })
    );

    const merged = mergeDuplicateScanWithPriorEligible(prev, incoming, false);

    expect(merged.signalResult.reason).toContain('Symbol policy blocked');
    expect(merged.signalResult.shouldCallGroq).toBe(false);
  });
});

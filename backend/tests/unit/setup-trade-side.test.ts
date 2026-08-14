import { describe, expect, it } from 'vitest';
import type {
  CandleData,
  SetupGateResult,
} from '../../src/analyzers/setup-gate.analyzer';
import { inferSetupTradeSide } from '../../src/utils/setup-trade-side';

function makeSetup(playbookKey: string | null): SetupGateResult {
  return {
    playbookKey,
    grade: 'A',
    confidence: 0.9,
    regime: 'trend',
    reason: 'test',
    detailReason: 'test',
    evidence: {
      regime: { trendDirection: 'bullish' },
    },
  } as unknown as SetupGateResult;
}

function flatCandles(count = 80): CandleData[] {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: index * 15 * 60_000,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
  }));
}

describe('inferSetupTradeSide', () => {
  it('does not fall back to regime when a breakout playbook has no direction', () => {
    expect(inferSetupTradeSide(makeSetup('breakout_volume'), '15m', flatCandles())).toBeNull();
  });

  it('does not fall back to regime when a sweep playbook has no direction', () => {
    expect(
      inferSetupTradeSide(makeSetup('liquidity_sweep_reclaim'), '15m', flatCandles())
    ).toBeNull();
  });

  it('fails closed for an unknown named playbook', () => {
    expect(inferSetupTradeSide(makeSetup('future_playbook'), '15m', flatCandles())).toBeNull();
  });

  it('still allows regime fallback when no directional playbook is selected', () => {
    expect(inferSetupTradeSide(makeSetup(null), '15m', flatCandles())).toBe('long');
  });
});

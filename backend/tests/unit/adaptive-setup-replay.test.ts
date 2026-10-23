import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/analyzers/setup-gate.analyzer', () => ({
  analyzeSetupGate: vi.fn(async ({ candles, symbol, timeframe }) => ({
    playbookKey: 'breakout_volume',
    grade: 'A',
    confidence: 0.85,
    regime: 'trend',
    reason: 'fixture breakout',
    detailReason: 'fixture breakout',
    evidence: {
      symbol,
      timeframe,
      candleCount: candles.length,
      lastCandleTime: candles.at(-1)?.timestamp ?? null,
      price: candles.at(-1)?.close ?? 0,
      regime: {
        regime: 'trend', volatilityPct: 1, trendStrengthPct: 1, rangePct: 2,
        avgPrice: 100, currentPrice: candles.at(-1)?.close ?? 100,
        matchedRule: 'fixture', trendDirection: 'bullish',
      },
      playbooks: [{
        playbook: 'breakout_volume', detected: true, grade: 'A', summary: 'fixture',
        metrics: { resistance: 100, support: 98 },
      }],
    },
  })),
}));

vi.mock('../../src/utils/setup-trade-side', () => ({
  inferSetupTradeSide: vi.fn(() => 'long'),
}));

vi.mock('../../src/utils/adaptive-setup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/adaptive-setup')>();
  return {
    ...actual,
    detectAdaptiveSetup: vi.fn((input) => input.close === 101
      ? { kind: 'aligned_micro_bos', boundary: 100, evidence: {} }
      : null),
    hasMicroBos: vi.fn(() => ({ pass: true, level: 100 })),
  };
});

import { runAdaptiveSetupReplay } from '../../src/backtest/adaptive-setup-replay';
import type { BacktestCandle } from '../../src/backtest/types';

function candle(timestamp: number, open: number, high: number, low: number, close: number): BacktestCandle {
  return { timestamp, open, high, low, close, volume: 1 };
}

function history(timeframeMs: number, endExclusive: number, count: number): BacktestCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const timestamp = endExclusive - (count - index) * timeframeMs;
    return candle(timestamp, 100, 100.2, 99.8, 100);
  });
}

describe('adaptive setup closed-candle replay', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.stubEnv('V3_ALIGNED_MICRO_BOS_RR', '3');
    vi.stubEnv('V3_ADAPTIVE_RETEST_TTL_MINUTES', '180');
  });

  it('can consume a risk-rejected retest instead of retrying the same claimed setup', async () => {
    vi.stubEnv('MAX_EFFECTIVE_RISK_PER_TRADE_USD', '1');
    vi.stubEnv('DAILY_LOSS_LIMIT_PERCENT', '3');
    const startMs = Date.UTC(2026, 8, 1);
    const five = history(300000, startMs, 60);
    five.push(candle(startMs,100,101.2,99.9,101),
      candle(startMs+300000,100,100.7,99.9,100.5),
      candle(startMs+600000,100,100.7,99.9,100.6));
    const input = { byTf: { '5m':five, '15m':history(900000,startMs,70),
      '1h':history(3600000,startMs,70), '4h':history(14400000,startMs,70) },
      start:new Date(startMs),end:new Date(startMs+900000),executionWalletUsd:10,
      minSlPct:.008,feePctPerSide:.0005,slippageFraction:.001,fundingHistory:[] };
    const retry = await runAdaptiveSetupReplay(input);
    const consumed = await runAdaptiveSetupReplay({...input,consumeExecutionRejectedRetests:true});
    expect(retry.account!.blocks.daily_budget).toBe(2);
    expect(consumed.account!.blocks.daily_budget).toBe(1);
    expect(consumed.outcomes).toHaveLength(0);
  });

  it('cannot confirm on the breakout bar and charges round-trip fees after a later retest', async () => {
    const startMs = Date.UTC(2026, 8, 1, 0, 0, 0);
    const five = history(5 * 60_000, startMs, 60);
    five.push(
      candle(startMs, 100, 101.2, 99.9, 101),
      candle(startMs + 5 * 60_000, 100, 100.7, 99.9, 100.5),
      candle(startMs + 10 * 60_000, 100.5, 103.1, 100.4, 103)
    );
    const end = new Date(startMs + 15 * 60_000);
    const result = await runAdaptiveSetupReplay({
      byTf: {
        '5m': five,
        '15m': history(15 * 60_000, startMs + 15 * 60_000, 70),
        '1h': history(60 * 60_000, startMs + 60 * 60_000, 70),
        '4h': history(4 * 60 * 60_000, startMs + 4 * 60 * 60_000, 70),
      },
      start: new Date(startMs),
      end,
      minSlPct: 0.008,
      feePctPerSide: 0.0004,
    });

    const stats = result.byKind.aligned_micro_bos;
    expect(stats.candidates).toBe(1);
    expect(stats.confirmed).toBe(1);
    expect(stats.outcomes).toBe(1);
    expect(result.outcomes[0]).toMatchObject({
      detectedAt: startMs + 5 * 60_000,
      confirmedAt: startMs + 10 * 60_000,
      closeReason: 'take_profit',
      grossR: 3,
    });
    expect(result.outcomes[0].netR).toBeCloseTo(2.9, 8);
    vi.stubEnv('MAX_EFFECTIVE_RISK_PER_TRADE_USD', '1');
    vi.stubEnv('DAILY_LOSS_LIMIT_PERCENT', '3');
    const financial = await runAdaptiveSetupReplay({
      byTf: { '5m': five, '15m': history(15*60_000,startMs+15*60_000,70),
        '1h': history(60*60_000,startMs+60*60_000,70),
        '4h': history(4*60*60_000,startMs+4*60*60_000,70) },
      start: new Date(startMs), end, minSlPct:.008, feePctPerSide:.0005,
      executionWalletUsd:20, slippageFraction:.001, fundingHistory:[],
    });
    expect(financial.outcomes).toHaveLength(1);
    expect(financial.outcomes[0].financial?.feesUsd).toBeGreaterThan(0);
    expect(financial.outcomes[0].financial?.slippageUsd).toBeGreaterThan(0);
    expect(financial.account!.endingWallet-20).toBeCloseTo(financial.outcomes[0].financial!.netUsd,10);
    expect(financial.outcomes[0].netR).toBeLessThan(result.outcomes[0].netR);
  });
});

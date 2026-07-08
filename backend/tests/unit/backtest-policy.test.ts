import { describe, expect, it } from 'vitest';
import { buildBreakdown, utcDayKey, utcWeekKey } from '../../src/backtest/breakdown';
import type { BacktestTrade } from '../../src/backtest/types';
import { resolveLossCooldownUntil } from '../../src/config/risk-policy';
import {
  evaluate5mEntryGuards,
  evaluateSetupGradePlaybookFilter,
  getBinanceMinOrderNotionalUsd,
  resolveTargetPositionNotionalUsd,
} from '../../src/config/v3-entry-policy';

const sampleTrade = (overrides: Partial<BacktestTrade> = {}): BacktestTrade => ({
  id: 1,
  side: 'long',
  timeframe: '5m',
  playbookKey: 'breakout_volume',
  grade: 'B',
  entryTime: Date.parse('2026-06-01T12:00:00Z'),
  entryPrice: 60_000,
  stopLoss: 59_760,
  takeProfit: 60_480,
  slDistancePct: 0.4,
  rr: 2,
  closeTime: Date.parse('2026-06-01T14:00:00Z'),
  closePrice: 60_480,
  closeReason: 'take_profit',
  pnlUsd: 10,
  pnlPct: 0.5,
  barsHeld: 24,
  ...overrides,
});

describe('backtest breakdown', () => {
  it('groups by timeframe and sums PnL', () => {
    const rows = buildBreakdown(
      [sampleTrade(), sampleTrade({ timeframe: '15m', pnlUsd: -5 })],
      (t) => t.timeframe
    );
    const m5 = rows.find((r) => r.key === '5m');
    expect(m5?.netPnl).toBe(10);
    expect(m5?.wins).toBe(1);
  });

  it('utc day/week keys are stable', () => {
    const ts = Date.parse('2026-06-03T10:00:00Z');
    expect(utcDayKey(ts)).toBe('2026-06-03');
    expect(utcWeekKey(ts)).toMatch(/^2026-W\d{2}$/);
  });
});

describe('loss cooldown tiers', () => {
  it('tier2 = 6h from last loss', () => {
    const from = new Date('2026-06-01T10:00:00Z');
    const until = resolveLossCooldownUntil(2, from);
    expect(until?.toISOString()).toBe('2026-06-01T16:00:00.000Z');
  });

  it('tier3 uses max(12h, EOD UTC)', () => {
    const from = new Date('2026-06-01T20:00:00Z');
    const until = resolveLossCooldownUntil(3, from);
    expect(until?.toISOString()).toBe('2026-06-02T08:00:00.000Z');
  });
});

describe('5m entry guards', () => {
  it('blocks 5m when 1h range', () => {
    const r = evaluate5mEntryGuards({
      entryTimeframe: '5m',
      side: 'long',
      tf1h: { regime: 'range', trendDirection: null },
      tf15m: { regime: 'trend', trendDirection: 'bullish' },
      block5mWhen1hRange: true,
      require5mHtfConfirm: false,
    });
    expect(r.pass).toBe(false);
  });

  it('requires 15m or 1h trend aligned with side', () => {
    const fail = evaluate5mEntryGuards({
      entryTimeframe: '5m',
      side: 'long',
      tf1h: { regime: 'trend', trendDirection: 'bearish' },
      tf15m: { regime: 'range', trendDirection: null },
      block5mWhen1hRange: false,
      require5mHtfConfirm: true,
    });
    expect(fail.pass).toBe(false);

    const pass = evaluate5mEntryGuards({
      entryTimeframe: '5m',
      side: 'long',
      tf1h: { regime: 'trend', trendDirection: 'bullish' },
      tf15m: { regime: 'range', trendDirection: null },
      block5mWhen1hRange: false,
      require5mHtfConfirm: true,
    });
    expect(pass.pass).toBe(true);
  });
});

describe('resolveTargetPositionNotionalUsd', () => {
  it('floors at min notional when risk-based size is smaller', () => {
    expect(
      resolveTargetPositionNotionalUsd({
        computedUsd: 125,
        minNotionalUsd: 200,
        remainingCapacityUsd: 2000,
      })
    ).toBe(200);
  });

  it('caps at remaining exposure headroom', () => {
    expect(
      resolveTargetPositionNotionalUsd({
        computedUsd: 500,
        minNotionalUsd: 200,
        remainingCapacityUsd: 300,
      })
    ).toBe(300);
  });
});

describe('getBinanceMinOrderNotionalUsd', () => {
  it('defaults to 200', () => {
    delete process.env.BINANCE_MIN_ORDER_NOTIONAL_USD;
    expect(getBinanceMinOrderNotionalUsd()).toBe(200);
  });
});

describe('grade playbook filter', () => {
  it('grade B breakout blocked when allowlist is sweep only', () => {
    const r = evaluateSetupGradePlaybookFilter({
      grade: 'B',
      confidence: 0.9,
      playbookKey: 'breakout_volume',
      gradeBAllowedPlaybooks: ['liquidity_sweep_reclaim'],
    });
    expect(r.pass).toBe(false);
  });
});

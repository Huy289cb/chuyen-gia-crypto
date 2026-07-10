import { describe, expect, it } from 'vitest';
import { checkBarForExit, closePositionAt } from '../../src/backtest/position-simulator';
import type { OpenSimPosition } from '../../src/backtest/position-simulator';

const basePos: OpenSimPosition = {
  id: 1,
  side: 'long',
  timeframe: '5m',
  playbookKey: 'breakout_volume',
  grade: 'A',
  entryTime: 1_000_000,
  entryPrice: 60_000,
  stopLoss: 59_760,
  takeProfit: 60_480,
  slDistancePct: 0.4,
  rr: 2,
  notionalUsd: 2000,
  feePctPerSide: 0.0004,
  entryBarIndex: 0,
};

describe('position simulator', () => {
  it('detects long stop loss hit on bar low', () => {
    const hit = checkBarForExit(basePos, {
      timestamp: 1_300_000,
      open: 60_100,
      high: 60_150,
      low: 59_700,
      close: 59_800,
      volume: 1,
    });
    expect(hit?.closeReason).toBe('stop_loss');
    expect(hit?.closePrice).toBe(59_760);
  });

  it('detects long take profit hit on bar high', () => {
    const hit = checkBarForExit(basePos, {
      timestamp: 1_300_000,
      open: 60_200,
      high: 60_500,
      low: 60_100,
      close: 60_450,
      volume: 1,
    });
    expect(hit?.closeReason).toBe('take_profit');
    expect(hit?.closePrice).toBe(60_480);
  });

  it('computes net PnL after fees for losing long', () => {
    const trade = closePositionAt(basePos, 1_300_000, 59_760, 'stop_loss', 3);
    expect(trade.pnlUsd).toBeLessThan(0);
    expect(trade.closeReason).toBe('stop_loss');
  });
});

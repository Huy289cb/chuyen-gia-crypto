import { describe, expect, it } from 'vitest';
import {
  calculateClosedTradeMetrics,
  calculateFullHistoryWalletMetrics,
  isReportableClosedTrade,
} from '../../src/services/account-performance.service';

describe('account performance metrics', () => {
  it('counts real reconciliation PnL but excludes zero-PnL bookkeeping rows', () => {
    const rows = [
      { position_id: 'win-1', side: 'LONG', close_reason: 'take_profit', realized_pnl: 3 },
      { position_id: 'win-2', side: 'SHORT', close_reason: 'manual', realized_pnl: 1 },
      { position_id: 'loss-1', side: 'LONG', close_reason: 'stop_loss', realized_pnl: -2 },
      { position_id: 'be-1', side: 'LONG', close_reason: 'manual', realized_pnl: 0.005 },
      {
        position_id: 'reconciled-loss',
        side: 'SHORT',
        close_reason: 'reconciliation_fill',
        realized_pnl: -1,
      },
      {
        position_id: 'bookkeeping-only',
        side: 'LONG',
        close_reason: 'reconciliation_fill',
        realized_pnl: 0,
      },
      {
        position_id: 'pipeline_v3_kim_nghia',
        side: 'NONE',
        close_reason: 'pipeline_event',
        realized_pnl: 99,
      },
    ];

    expect(isReportableClosedTrade(rows[4])).toBe(true);
    expect(isReportableClosedTrade(rows[5])).toBe(false);

    const metrics = calculateClosedTradeMetrics(rows);
    expect(metrics.totalTrades).toBe(5);
    expect(metrics.wins).toBe(2);
    expect(metrics.losses).toBe(2);
    expect(metrics.breakeven).toBe(1);
    expect(metrics.winRate).toBe(50);
    expect(metrics.winRateAllClosed).toBe(40);
    expect(metrics.grossProfit).toBe(4);
    expect(metrics.grossLoss).toBe(3);
    expect(metrics.avgWin).toBe(2);
    expect(metrics.avgLoss).toBe(1.5);
    expect(metrics.profitFactor).toBeCloseTo(4 / 3, 8);
  });

  it('derives wallet PnL and all-time drawdown from the full snapshot path', () => {
    const metrics = calculateFullHistoryWalletMetrics(
      { starting_balance: 40, current_balance: 31.8, equity: 31.8 },
      [
        { balance: 44, equity: 44, timestamp: new Date('2026-07-01T00:00:00Z') },
        { balance: 52, equity: 52, timestamp: new Date('2026-07-10T00:00:00Z') },
        { balance: 39, equity: 39, timestamp: new Date('2026-08-01T00:00:00Z') },
        { balance: 31.8, equity: 31.8, timestamp: new Date('2026-08-14T00:00:00Z') },
      ]
    );

    expect(metrics.scope).toBe('full_history');
    expect(metrics.walletPnl).toBeCloseTo(-8.2, 8);
    expect(metrics.walletReturnPercent).toBeCloseTo(-20.5, 8);
    expect(metrics.peakEquity).toBe(52);
    expect(metrics.currentDrawdownPercent).toBeCloseTo((20.2 / 52) * 100, 8);
    expect(metrics.maxDrawdownPercent).toBeCloseTo((20.2 / 52) * 100, 8);
    expect(metrics.snapshotCount).toBe(4);
  });
});

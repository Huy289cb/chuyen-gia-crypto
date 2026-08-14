import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindAccount = vi.hoisted(() => vi.fn());
const mockFindPositions = vi.hoisted(() => vi.fn());
const mockFindSnapshots = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    testnetAccount: { findUnique: mockFindAccount },
    testnetPosition: { findMany: mockFindPositions },
    testnetAccountSnapshot: { findMany: mockFindSnapshots },
  },
}));

import { getTestnetPerformanceMetrics } from '../../src/repositories/testnet.repository';

describe('getTestnetPerformanceMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindAccount.mockResolvedValue({
      id: 7,
      symbol: 'BTC',
      method_id: 'kim_nghia',
      starting_balance: 100,
      current_balance: 90,
      equity: 90,
      realized_pnl: -99,
      total_trades: 2,
      winning_trades: 2,
      losing_trades: 0,
      max_drawdown: 11,
    });
    mockFindPositions.mockResolvedValue([
      { position_id: 'w', side: 'LONG', close_reason: 'take_profit', realized_pnl: 4 },
      { position_id: 'l', side: 'LONG', close_reason: 'stop_loss', realized_pnl: -2 },
      {
        position_id: 'bookkeeping',
        side: 'LONG',
        close_reason: 'reconciliation_fill',
        realized_pnl: 0,
      },
    ]);
    mockFindSnapshots.mockResolvedValue([
      { balance: 100, equity: 100, timestamp: new Date('2026-01-01T00:00:00Z') },
      { balance: 120, equity: 120, timestamp: new Date('2026-02-01T00:00:00Z') },
      { balance: 90, equity: 90, timestamp: new Date('2026-03-01T00:00:00Z') },
    ]);
  });

  it('uses gross wins/losses and snapshot history instead of stale account counters', async () => {
    const result = await getTestnetPerformanceMetrics(7);

    expect(result.total_trades).toBe(2);
    expect(result.winning_trades).toBe(1);
    expect(result.losing_trades).toBe(1);
    expect(result.win_rate).toBe(50);
    expect(result.avg_win).toBe(4);
    expect(result.avg_loss).toBe(2);
    expect(result.profit_factor).toBe(2);
    expect(result.position_pnl).toBe(2);
    expect(result.wallet_pnl).toBe(-10);
    expect(result.total_return).toBe(-10);
    expect(result.max_drawdown).toBe(25);
    expect(result.full_history.scope).toBe('full_history');
  });
});

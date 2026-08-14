import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetCircuitStatus = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/account-circuit.service', () => ({
  getAccountCircuitStatus: mockGetCircuitStatus,
}));

import performanceRouter from '../../src/routes/performance';

describe('/api/performance routes', () => {
  const findAccount = vi.fn();
  const findPositions = vi.fn();
  const countPositions = vi.fn();
  const findSnapshots = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    findAccount.mockResolvedValue({
      id: 42,
      symbol: 'BTC',
      method_id: 'kim_nghia',
      starting_balance: 40,
      current_balance: 35,
      equity: 34,
    });
    findPositions.mockResolvedValue([
      {
        position_id: 'real-reconciliation',
        symbol: 'BTC',
        side: 'LONG',
        close_reason: 'reconciliation_fill',
        realized_pnl: -2,
        entry_time: new Date('2026-08-01T00:00:00Z'),
        close_time: new Date('2026-08-01T01:00:00Z'),
      },
      {
        position_id: 'win',
        symbol: 'BTC',
        side: 'SHORT',
        close_reason: 'take_profit',
        realized_pnl: 3,
        entry_time: new Date('2026-08-02T00:00:00Z'),
        close_time: new Date('2026-08-02T01:00:00Z'),
      },
    ]);
    countPositions.mockResolvedValue(2);
    findSnapshots.mockResolvedValue([
      { balance: 35, equity: 34, timestamp: new Date('2026-08-02T00:00:00Z') },
      { balance: 42, equity: 42, timestamp: new Date('2026-08-01T00:00:00Z') },
    ]);
    mockGetCircuitStatus.mockResolvedValue({
      scope: 'strategy_epoch',
      epochStart: new Date('2026-08-01T00:00:00Z'),
      peakEquitySource: 'override',
      expectancySince: new Date('2026-08-01T00:00:00Z'),
      allowed: true,
      reason: 'circuits clear',
      dailyLossUsd: 0,
      dailyLossPercent: 0,
      dailyLossLimitPercent: 2,
      peakEquity: 38,
      drawdownPercent: 10.5,
      maxDrawdownPercent: 15,
      expectancy: { n: 2, sumR: 1, avgR: 0.5, profitFactor: 1.5 },
    });
  });

  async function invoke(path: string, query: Record<string, string>) {
    const fakePrisma = {
      testnetAccount: { findUnique: findAccount },
      testnetPosition: { findMany: findPositions, count: countPositions },
      testnetAccountSnapshot: { findMany: findSnapshots },
    };
    const layer = (performanceRouter as any).stack.find(
      (candidate: any) => candidate.route?.path === path
    );
    let status = 200;
    let body: any;
    const req = { query, prisma: fakePrisma };
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: any) {
        body = payload;
        return this;
      },
    };
    await layer.route.stack[0].handle(req, res, vi.fn());
    return { status, body };
  }

  it('reports full testnet history and labels the circuit as strategy epoch', async () => {
    const response = await invoke('/', { symbol: 'btc', method: 'kim_nghia' });

    expect(response.status).toBe(200);
    expect(findAccount).toHaveBeenCalledWith({
      where: { symbol_method_id: { symbol: 'BTC', method_id: 'kim_nghia' } },
    });
    expect(response.body.data.total_trades).toBe(2);
    expect(response.body.data.win_rate).toBe(50);
    expect(response.body.data.wallet_pnl).toBe(-5);
    expect(response.body.data.full_history.scope).toBe('full_history');
    expect(response.body.data.strategy_epoch.scope).toBe('strategy_epoch');
    expect(response.body.data.strategy_epoch.drawdown_percent).toBe(10.5);
  });

  it('reads recent equity points from testnetAccountSnapshot in chronological order', async () => {
    const response = await invoke('/equity-curve', {
      symbol: 'BTC',
      method: 'kim_nghia',
      limit: '2',
    });

    expect(response.status).toBe(200);
    expect(findSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { account_id: 42 },
        orderBy: { timestamp: 'desc' },
        take: 2,
      })
    );
    expect(response.body.meta.source).toBe('testnet_account_snapshots');
    expect(response.body.data.map((point: { equity: number }) => point.equity)).toEqual([42, 34]);
  });

  it('uses testnetPosition for paginated trade history', async () => {
    const response = await invoke('/trades', {
      symbol: 'BTC',
      method: 'kim_nghia',
      limit: '10',
      page: '1',
    });

    expect(response.status).toBe(200);
    expect(countPositions).toHaveBeenCalledOnce();
    expect(findPositions).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 0, orderBy: { close_time: 'desc' } })
    );
    expect(response.body.meta.total).toBe(2);
  });
});

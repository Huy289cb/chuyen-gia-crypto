import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/repositories/testnet.repository', () => ({
  getTestnetAccount: vi.fn(),
  getTestnetPositions: vi.fn().mockResolvedValue([]),
  getTestnetPendingOrders: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    testnetAccountSnapshot: { findFirst: vi.fn() },
    testnetPosition: { aggregate: vi.fn() },
  },
}));

vi.mock('../../src/services/binance-balance-sync.service', () => ({
  syncTestnetAccountFromBinance: vi.fn(),
}));

vi.mock('../../src/services/binance-exposure.service', () => ({
  fetchActiveBinancePositions: vi.fn(),
}));

vi.mock('../../src/services/binance/trading', () => ({
  getOpenOrders: vi.fn(),
  getOpenAlgoOrders: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/services/binance-income.service', () => ({
  fetchBinanceIncomeSummary: vi.fn(),
}));

vi.mock('../../src/services/binance-trade-history.service', () => ({
  fetchBinanceClosedTradeRounds: vi.fn(),
}));

import { getTestnetAccount } from '../../src/repositories/testnet.repository';
import { prisma } from '../../src/lib/prisma';
import { fetchActiveBinancePositions } from '../../src/services/binance-exposure.service';
import { fetchBinanceIncomeSummary } from '../../src/services/binance-income.service';
import { fetchBinanceClosedTradeRounds } from '../../src/services/binance-trade-history.service';
import {
  getAccountBalanceSummary,
  getTodayTradeStatsIct,
} from '../../src/services/account-summary.service';

describe('account-summary PnL (Binance)', () => {
  const prevBinance = process.env.BINANCE_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BINANCE_ENABLED = 'true';
    vi.mocked(getTestnetAccount).mockResolvedValue({
      id: 1,
      symbol: 'BTC',
      method_id: 'kim_nghia',
      starting_balance: 5000,
      current_balance: 4980,
      equity: 4990,
      unrealized_pnl: 10,
      realized_pnl: -15,
      accumulated_trading_fees: 2,
      accumulated_funding_fee: 0,
    } as never);
    vi.mocked(prisma.testnetAccountSnapshot.findFirst).mockResolvedValue({
      equity: 5000,
    } as never);
    vi.mocked(prisma.testnetPosition.aggregate).mockResolvedValue({ _sum: { realized_pnl: 0, unrealized_pnl: 0, risk_usd: 0 } });
    vi.mocked(fetchActiveBinancePositions).mockResolvedValue([
      {
        symbol: 'BTC',
        symbolUsdt: 'BTCUSDT',
        side: 'short',
        positionAmt: 0.01,
        entryPrice: 66000,
        markPrice: 65500,
        unRealizedProfit: 10,
        notional: -655,
        rawPositionSide: 'BOTH',
      },
    ]);
  });

  afterEach(() => {
    process.env.BINANCE_ENABLED = prevBinance;
  });

  it('uses equity delta for daily PnL when Binance enabled', async () => {
    const summary = await getAccountBalanceSummary('BTC', 'kim_nghia', true, false);
    expect(summary.dailyPnL).toBeCloseTo(-10, 2);
    expect(summary.openUnrealized).toBeCloseTo(10, 2);
    expect(summary.dbPositionPnlTrusted).toBe(false);
  });

  it('loads today trade stats from Binance income + rounds', async () => {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);

    vi.mocked(fetchBinanceIncomeSummary).mockResolvedValue({
      realizedPnl: 12,
      commission: -1,
      fundingFee: 0,
      transferNet: 0,
      netTradingPnl: 11,
      rowCount: 3,
    });
    vi.mocked(fetchBinanceClosedTradeRounds).mockResolvedValue([
      {
        id: 'r1',
        symbol: 'BTC',
        side: 'long',
        entryPrice: 100,
        closePrice: 110,
        quantity: 1,
        fee: 0.1,
        realizedPnL: 8,
        closeReason: 'binance_fills',
        status: 'closed',
        closedAt: new Date().toISOString(),
      },
      {
        id: 'r2',
        symbol: 'BTC',
        side: 'short',
        entryPrice: 200,
        closePrice: 210,
        quantity: 1,
        fee: 0.1,
        realizedPnL: -3,
        closeReason: 'binance_fills',
        status: 'closed',
        closedAt: new Date(Date.now() - 86400000).toISOString(),
      },
    ]);

    const stats = await getTodayTradeStatsIct('BTC', 'kim_nghia');
    expect(stats.source).toBe('binance');
    expect(stats.closedCount).toBe(1);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(0);
    expect(stats.totalRealizedPnl).toBe(11);
  });
});

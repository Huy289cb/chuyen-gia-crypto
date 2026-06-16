import { describe, it, expect, vi, beforeEach } from 'vitest';

const closeLocalPosition = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    testnetPendingOrder: { findMany: vi.fn().mockResolvedValue([]) },
    testnetPosition: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../../src/repositories/testnet.repository', () => ({
  getTestnetPendingOrders: vi.fn().mockResolvedValue([]),
  updateTestnetPendingOrder: vi.fn(),
  getTestnetPositions: vi.fn().mockResolvedValue([]),
  updateTestnetPosition: vi.fn(),
  recordTestnetTradeEvent: vi.fn(),
}));

vi.mock('../../src/services/binance-order-fill.service', () => ({
  ensureProtectiveOrdersForPosition: vi.fn(),
  recoverPendingOrderFromBinance: vi.fn(),
}));

vi.mock('../../src/services/binance-exposure.service', () => ({
  fetchActiveBinancePositions: vi.fn(),
  inferBinancePositionsFromFallback: vi.fn(),
  isBinancePositionRiskUnavailable: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/services/binance-fill-pnl.service', () => ({
  resolveClosePnlFromUserTrades: vi.fn(),
}));

vi.mock('../../src/services/binance-account-health.service', () => ({
  checkBinanceAccountTradable: vi.fn().mockResolvedValue({ tradable: true, reason: 'ok' }),
  isBinanceAccountKnownUnhealthy: vi.fn().mockReturnValue(false),
  recordBinanceTradingAccessObserved: vi.fn(),
}));

vi.mock('../../src/services/binanceClient', () => ({
  getOpenOrders: vi.fn().mockResolvedValue([]),
  getOpenAlgoOrders: vi.fn().mockResolvedValue([]),
  cancelAlgoOrder: vi.fn(),
}));

vi.mock('../../src/config/v3-entry-policy', () => ({
  isPhantomReopenEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/services/position-close.service', () => ({
  closeLocalPosition,
  closeDuplicateForMerge: vi.fn(),
}));

import { prisma } from '../../src/lib/prisma';
import { getTestnetPositions, updateTestnetPosition } from '../../src/repositories/testnet.repository';
import { fetchActiveBinancePositions } from '../../src/services/binance-exposure.service';
import { performStartupReconciliation } from '../../src/services/binance-reconciliation';

const mislabeledShort = {
  position_id: 'pos_mislabeled_short',
  symbol: 'BTC',
  side: 'short',
  status: 'reconciliation_failed_not_on_binance',
  entry_price: 62940,
  entry_time: new Date('2026-06-12T00:00:00.000Z'),
  size_qty: 0.0112,
  current_price: 66000,
};

describe('binance-reconciliation hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BINANCE_ENABLED = 'true';
    vi.mocked(fetchActiveBinancePositions).mockResolvedValue([
      {
        symbol: 'BTC',
        symbolUsdt: 'BTCUSDT',
        side: 'short',
        positionAmt: 0.0112,
        entryPrice: 62940,
        markPrice: 66000,
        rawPositionSide: 'BOTH',
      },
    ]);
  });

  it('does not reopen reconciliation_failed_not_on_binance rows', async () => {
    vi.mocked(prisma.testnetPosition.findMany).mockImplementation(async (args) => {
      const where = (args as { where?: Record<string, unknown> }).where;
      if (where?.status === 'open' && where?.symbol === 'BTC' && where?.side === 'short') {
        return [];
      }
      if (where?.status === 'reconciliation_failed_not_on_binance') {
        return [mislabeledShort];
      }
      return [];
    });

    await performStartupReconciliation();

    expect(updateTestnetPosition).not.toHaveBeenCalledWith(
      mislabeledShort.position_id,
      expect.objectContaining({ status: 'open' })
    );
  });

  it('uses strict positionRisk fetch (no userTrades fallback)', async () => {
    await performStartupReconciliation();

    expect(fetchActiveBinancePositions).toHaveBeenCalledWith(undefined, {
      allowUserTradesFallback: false,
    });
  });

  it('bookkeeping-closes phantom when positionRisk flat even if userTrades would show exposure', async () => {
    const openPhantom = {
      position_id: 'pos_phantom_fallback',
      symbol: 'BTC',
      side: 'short',
      status: 'open',
      size_qty: 0.01,
      entry_price: 62940,
      current_price: 66000,
      entry_time: new Date('2026-06-15T10:00:00.000Z'),
      binance_order_id: null,
      account_id: 1,
      account: { current_balance: 5000 },
    };

    vi.mocked(fetchActiveBinancePositions).mockResolvedValue([]);
    const { getTestnetPositions } = await import('../../src/repositories/testnet.repository');
    vi.mocked(getTestnetPositions).mockResolvedValue([openPhantom] as never);
    vi.mocked(prisma.testnetPosition.findUnique).mockResolvedValue(openPhantom as never);

    await performStartupReconciliation();

    expect(closeLocalPosition).toHaveBeenCalledWith(
      expect.objectContaining({ position_id: 'pos_phantom_fallback' }),
      66000,
      'reconciliation_closed_not_on_binance',
      expect.objectContaining({ bookkeeping_close: true })
    );
  });
});

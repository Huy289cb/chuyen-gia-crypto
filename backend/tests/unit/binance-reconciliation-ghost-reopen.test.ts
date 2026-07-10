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
  fetchBinancePositionRiskRows: vi.fn().mockResolvedValue([]),
  inferBinancePositionsFromFallback: vi.fn().mockResolvedValue([]),
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
  hasBinanceFillProof: (p: { binance_order_id?: string | null }) =>
    Boolean(p.binance_order_id?.trim()),
}));

import { prisma } from '../../src/lib/prisma';
import { updateTestnetPosition } from '../../src/repositories/testnet.repository';
import { fetchActiveBinancePositions } from '../../src/services/binance-exposure.service';
import { performStartupReconciliation } from '../../src/services/binance-reconciliation';

const ghostShort = {
  position_id: 'pos_1781504992771_ytmb3s',
  symbol: 'BTC',
  side: 'short',
  status: 'closed',
  entry_price: 62940,
  entry_time: new Date('2026-06-15T06:29:52.781Z'),
  close_time: new Date('2026-06-15T06:29:53.000Z'),
  close_reason: 'reconciliation_closed_not_on_binance',
  binance_order_id: '15002026111',
  size_qty: 0.0112,
  current_price: 66000,
};

describe('binance-reconciliation ghost short reopen', () => {
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
    vi.mocked(prisma.testnetPosition.findMany).mockImplementation(async (args) => {
      const where = (args as { where?: Record<string, unknown> }).where;
      if (where?.status === 'reconciliation_failed_not_on_binance') {
        return [];
      }
      if (where?.status === 'open' && where?.entry_time) {
        return [];
      }
      return [];
    });
  });

  it('does not resurrect rows closed via reconciliation_closed_not_on_binance', async () => {
    vi.mocked(prisma.testnetPosition.findMany).mockImplementation(async (args) => {
      const where = (args as { where?: Record<string, unknown> }).where;
      if (
        where?.status === 'reconciliation_failed_not_on_binance' ||
        (where?.symbol === 'BTC' && where?.side === 'short' && where?.status === 'reconciliation_failed_not_on_binance')
      ) {
        return [];
      }
      if (where?.side === 'short' && where?.symbol === 'BTC') {
        return [ghostShort];
      }
      return [];
    });

    await performStartupReconciliation();

    expect(updateTestnetPosition).not.toHaveBeenCalledWith(
      ghostShort.position_id,
      expect.objectContaining({ status: 'open' })
    );
    expect(closeLocalPosition).not.toHaveBeenCalled();
  });
});

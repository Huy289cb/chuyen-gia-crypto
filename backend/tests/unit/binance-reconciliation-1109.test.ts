import { describe, it, expect, vi, beforeEach } from 'vitest';

const closeLocalPosition = vi.fn();

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
  getTestnetPendingOrders: vi.fn(),
  updateTestnetPendingOrder: vi.fn(),
  getTestnetPositions: vi.fn(),
  updateTestnetPosition: vi.fn(),
  recordTestnetTradeEvent: vi.fn(),
}));

vi.mock('../../src/services/binance-order-fill.service', () => ({
  ensureProtectiveOrdersForPosition: vi.fn(),
  recoverPendingOrderFromBinance: vi.fn(),
}));

vi.mock('../../src/services/binance-exposure.service', () => ({
  fetchActiveBinancePositions: vi.fn(),
  fetchBinancePositionRiskRows: vi.fn(),
  inferBinancePositionsFromFallback: vi.fn().mockResolvedValue([]),
  isBinancePositionRiskUnavailable: vi.fn(),
}));

vi.mock('../../src/services/binance-account-health.service', () => ({
  checkBinanceAccountTradable: vi.fn().mockResolvedValue({ tradable: true, reason: 'ok' }),
  isBinanceAccountKnownUnhealthy: vi.fn().mockReturnValue(false),
  recordBinanceTradingAccessObserved: vi.fn(),
}));

const getOpenOrders = vi.fn();

vi.mock('../../src/services/binanceClient', () => ({
  getOpenOrders: (...args: unknown[]) => getOpenOrders(...args),
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

import { getTestnetPositions, getTestnetPendingOrders, updateTestnetPendingOrder } from '../../src/repositories/testnet.repository';
import { ensureProtectiveOrdersForPosition, recoverPendingOrderFromBinance } from '../../src/services/binance-order-fill.service';
import {
  fetchActiveBinancePositions,
  isBinancePositionRiskUnavailable,
} from '../../src/services/binance-exposure.service';
import { performStartupReconciliation } from '../../src/services/binance-reconciliation';

describe('binance-reconciliation demo -1109', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BINANCE_ENABLED = 'true';
    vi.mocked(getTestnetPendingOrders).mockImplementation(async (filters) => {
      if (filters?.status === 'pending') {
        return [
          {
            order_id: 'v3_pending_1',
            symbol: 'BTC',
            binance_order_id: '15136279285',
            status: 'pending',
          },
        ] as never;
      }
      return [] as never;
    });
    getOpenOrders.mockRejectedValue(new Error('Binance API Error -1109: Invalid account.'));
    vi.mocked(getTestnetPositions).mockResolvedValue([
      {
        position_id: 'pos-1',
        symbol: 'BTC',
        side: 'long',
        status: 'open',
        size_qty: 0.02,
        entry_price: 100000,
        current_price: 100100,
      },
    ] as never);
    vi.mocked(fetchActiveBinancePositions).mockResolvedValue([]);
    vi.mocked(isBinancePositionRiskUnavailable).mockReturnValue(true);
  });

  it('does not close local open positions when positionRisk is unavailable (-1109)', async () => {
    await performStartupReconciliation();

    expect(ensureProtectiveOrdersForPosition).toHaveBeenCalled();
    expect(closeLocalPosition).not.toHaveBeenCalled();
  });

  it('does not mark pending as reconciliation_failed when openOrders returns -1109', async () => {
    await performStartupReconciliation();

    expect(recoverPendingOrderFromBinance).not.toHaveBeenCalled();
    expect(updateTestnetPendingOrder).not.toHaveBeenCalledWith(
      'v3_pending_1',
      expect.objectContaining({ status: 'reconciliation_failed_not_on_binance' })
    );
  });
});

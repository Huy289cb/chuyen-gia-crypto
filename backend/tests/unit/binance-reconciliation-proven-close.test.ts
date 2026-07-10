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
  inferBinancePositionsFromFallback: vi.fn().mockResolvedValue([]),
  isBinancePositionRiskUnavailable: vi.fn(),
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
import { getTestnetPositions } from '../../src/repositories/testnet.repository';
import {
  fetchActiveBinancePositions,
  isBinancePositionRiskUnavailable,
} from '../../src/services/binance-exposure.service';
import { performStartupReconciliation } from '../../src/services/binance-reconciliation';

const openProvenPosition = {
  position_id: 'pos_proven',
  symbol: 'BTC',
  side: 'long',
  status: 'open',
  size_qty: 0.0111,
  entry_price: 67120,
  current_price: 67185.6,
  entry_time: new Date('2026-06-15T15:53:32.000Z'),
  binance_order_id: '15243540740',
  account_id: 1,
  account: { current_balance: 5003.32 },
};

describe('binance-reconciliation absent-on-Binance close', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BINANCE_ENABLED = 'true';
    vi.mocked(fetchActiveBinancePositions).mockResolvedValue([]);
    vi.mocked(isBinancePositionRiskUnavailable).mockReturnValue(false);
    vi.mocked(getTestnetPositions).mockResolvedValue([openProvenPosition] as never);
    vi.mocked(prisma.testnetPosition.findUnique).mockResolvedValue(openProvenPosition as never);
  });

  it('proven-fill close via reconciliation (no bookkeeping flag)', async () => {
    await performStartupReconciliation();

    expect(closeLocalPosition).toHaveBeenCalledWith(
      expect.objectContaining({ position_id: 'pos_proven', binance_order_id: '15243540740' }),
      67185.6,
      'reconciliation_closed_not_on_binance',
      expect.objectContaining({ verified_binance_zero: true })
    );
    expect(closeLocalPosition).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.not.objectContaining({ bookkeeping_close: true })
    );
  });
});

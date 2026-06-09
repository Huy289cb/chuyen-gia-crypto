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
  fetchBinancePositionRiskRows: vi.fn(),
  inferBinancePositionsFromFallback: vi.fn().mockResolvedValue([]),
  isBinancePositionRiskUnavailable: vi.fn(),
}));

vi.mock('../../src/services/binance-account-health.service', () => ({
  checkBinanceAccountTradable: vi.fn().mockResolvedValue({ tradable: true, reason: 'ok' }),
  isBinanceAccountKnownUnhealthy: vi.fn().mockReturnValue(false),
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

import { getTestnetPositions } from '../../src/repositories/testnet.repository';
import { ensureProtectiveOrdersForPosition } from '../../src/services/binance-order-fill.service';
import {
  fetchActiveBinancePositions,
  isBinancePositionRiskUnavailable,
} from '../../src/services/binance-exposure.service';
import { performStartupReconciliation } from '../../src/services/binance-reconciliation';

describe('binance-reconciliation demo -1109', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BINANCE_ENABLED = 'true';
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
});

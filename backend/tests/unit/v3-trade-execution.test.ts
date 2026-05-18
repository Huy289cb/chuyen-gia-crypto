import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/repositories/testnet.repository', () => ({
  getOrCreateTestnetAccount: vi.fn(),
  getTestnetPositions: vi.fn(),
  getTestnetPendingOrders: vi.fn(),
  createTestnetPendingOrder: vi.fn(),
}));

vi.mock('../../src/services/binanceClient', () => ({
  initTestnetClient: vi.fn(),
  placeLimitOrder: vi.fn(),
}));

vi.mock('../../src/config/methods', () => ({
  getMethodConfig: vi.fn(() => ({
    autoEntry: {
      minSLDistancePercent: 0.005,
      maxPositionsPerSymbol: 6,
      maxPendingVolume: 2000,
      maxPendingOrderSize: 2000,
    },
  })),
}));

import { executeV3Trade } from '../../src/services/v3-trade-execution.service';
import {
  getOrCreateTestnetAccount,
  getTestnetPositions,
  getTestnetPendingOrders,
  createTestnetPendingOrder,
} from '../../src/repositories/testnet.repository';
import { initTestnetClient, placeLimitOrder } from '../../src/services/binanceClient';

describe('executeV3Trade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BINANCE_ENABLED = 'true';
  });

  it('rejects when BINANCE_ENABLED is false', async () => {
    process.env.BINANCE_ENABLED = 'false';
    const result = await executeV3Trade({
      symbol: 'BTC',
      timeframe: '1h',
      analysis: {
        bias: 'bullish',
        action: 'buy',
        confidence: 0.9,
        suggested_entry: 100000,
        suggested_stop_loss: 99000,
        suggested_take_profit: 102000,
      },
    });
    expect(result.success).toBe(false);
    expect(result.reason).toContain('BINANCE_ENABLED');
  });

  it('places limit order and creates pending order on valid trade', async () => {
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 10000,
    } as never);
    vi.mocked(getTestnetPositions).mockResolvedValue([]);
    vi.mocked(getTestnetPendingOrders).mockResolvedValue([]);
    vi.mocked(initTestnetClient).mockReturnValue({} as never);
    vi.mocked(placeLimitOrder).mockResolvedValue({ orderId: 12345 } as never);
    vi.mocked(createTestnetPendingOrder).mockResolvedValue({ order_id: 'v3_test' } as never);

    const result = await executeV3Trade({
      symbol: 'BTC',
      timeframe: '1h',
      analysis: {
        bias: 'bullish',
        action: 'buy',
        confidence: 0.9,
        suggested_entry: 100000,
        suggested_stop_loss: 99000,
        suggested_take_profit: 102000,
        expected_rr: 2,
      },
    });

    expect(result.success).toBe(true);
    expect(result.binanceOrderId).toBe('12345');
    expect(placeLimitOrder).toHaveBeenCalled();
    expect(createTestnetPendingOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        side: 'long',
        binanceOrderId: '12345',
        methodId: 'kim_nghia',
      })
    );
  });
});

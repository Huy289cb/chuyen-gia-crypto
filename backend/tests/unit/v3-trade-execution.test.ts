import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/repositories/testnet.repository', () => ({
  getOrCreateTestnetAccount: vi.fn(),
  getActiveTestnetPositions: vi.fn(),
  getTestnetPendingOrders: vi.fn(),
  createTestnetPendingOrder: vi.fn(),
}));

vi.mock('../../src/services/binance-exposure.service', () => ({
  hasBinanceExposureForSide: vi.fn(),
}));

vi.mock('../../src/services/account-risk-guard.service', () => ({
  assertTestnetAccountCanOpenTrade: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('../../src/services/binance-hedge-mode', () => ({
  ensurePositionModeDetected: vi.fn().mockResolvedValue('ONE_WAY'),
}));

vi.mock('../../src/services/binanceClient', () => ({
  initTestnetClient: vi.fn(),
  normalizeQuantityForSymbol: vi.fn(),
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
  getActiveTestnetPositions,
  getTestnetPendingOrders,
  createTestnetPendingOrder,
} from '../../src/repositories/testnet.repository';
import { hasBinanceExposureForSide } from '../../src/services/binance-exposure.service';
import {
  initTestnetClient,
  normalizeQuantityForSymbol,
  placeLimitOrder,
} from '../../src/services/binanceClient';

describe('executeV3Trade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BINANCE_ENABLED = 'true';
    vi.mocked(hasBinanceExposureForSide).mockResolvedValue(false);
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
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([]);
    vi.mocked(getTestnetPendingOrders).mockResolvedValue([]);
    vi.mocked(initTestnetClient).mockReturnValue({} as never);
    vi.mocked(normalizeQuantityForSymbol).mockResolvedValue({
      rawQty: 0.01,
      normalizedQty: 0.01,
      stepSize: 0.0001,
      minQty: 0.0001,
      valid: true,
    });
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

  it('rejects same-side open position (no scaling-in)', async () => {
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 10000,
    } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([
      { side: 'long', size_usd: 500 },
    ] as never);
    vi.mocked(getTestnetPendingOrders).mockResolvedValue([]);

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
    expect(result.reason).toContain('Same-side');
    expect(placeLimitOrder).not.toHaveBeenCalled();
  });

  it('rejects when Binance already has same-side exposure', async () => {
    vi.mocked(hasBinanceExposureForSide).mockResolvedValue(true);
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 10000,
    } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([]);
    vi.mocked(getTestnetPendingOrders).mockResolvedValue([]);

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
    expect(result.reason).toContain('Binance already has');
    expect(placeLimitOrder).not.toHaveBeenCalled();
  });

  it('rejects when normalized quantity is invalid', async () => {
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 10000,
    } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([]);
    vi.mocked(getTestnetPendingOrders).mockResolvedValue([]);
    vi.mocked(normalizeQuantityForSymbol).mockResolvedValue({
      rawQty: 0.00001,
      normalizedQty: 0,
      stepSize: 0.0001,
      minQty: 0.0001,
      valid: false,
      reason: 'Quantity normalized to 0',
    });

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
    expect(result.reason).toContain('normalized');
    expect(placeLimitOrder).not.toHaveBeenCalled();
  });
});

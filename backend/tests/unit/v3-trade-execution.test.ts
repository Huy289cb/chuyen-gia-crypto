import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/repositories/testnet.repository', () => ({
  getOrCreateTestnetAccount: vi.fn(),
  getActiveTestnetPositions: vi.fn(),
  getBlockingTestnetPendingOrders: vi.fn(),
  createTestnetPendingOrder: vi.fn(),
}));

vi.mock('../../src/services/v3-entry-eligibility.service', () => ({
  assertScaleInSideAllowed: vi.fn(),
  assertSameSidePostCloseCooldown: vi.fn(),
  getSymbolExposureSnapshot: vi.fn(),
  oppositeLocalSide: (side: 'long' | 'short') => (side === 'long' ? 'short' : 'long'),
}));

vi.mock('../../src/config/v3-entry-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/v3-entry-policy')>();
  return {
    ...actual,
    isV3ScaleInEnabled: vi.fn(() => true),
    isV3OppositeFlipEnabled: vi.fn(() => false),
    getBinanceMinOrderNotionalUsd: vi.fn(() => 200),
    resolveMaxTotalExposureUsd: vi.fn((_b: number, fallback: number) => fallback),
  };
});

vi.mock('../../src/services/opposite-flip.service', () => ({
  tryOppositeFlipBeforeEntry: vi.fn().mockResolvedValue({ flipped: false, reason: 'no opposite exposure' }),
}));

vi.mock('../../src/services/account-risk-guard.service', () => ({
  assertTestnetAccountCanOpenTrade: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('../../src/services/binance-account-health.service', () => ({
  checkBinanceAccountTradable: vi.fn().mockResolvedValue({ tradable: true, reason: 'ok' }),
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
  getBlockingTestnetPendingOrders,
  createTestnetPendingOrder,
} from '../../src/repositories/testnet.repository';
import {
  assertScaleInSideAllowed,
  assertSameSidePostCloseCooldown,
  getSymbolExposureSnapshot,
} from '../../src/services/v3-entry-eligibility.service';
import { isV3ScaleInEnabled } from '../../src/config/v3-entry-policy';
import { checkBinanceAccountTradable } from '../../src/services/binance-account-health.service';
import {
  initTestnetClient,
  normalizeQuantityForSymbol,
  placeLimitOrder,
} from '../../src/services/binanceClient';

describe('executeV3Trade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BINANCE_ENABLED = 'true';
    vi.mocked(isV3ScaleInEnabled).mockReturnValue(true);
    vi.mocked(assertScaleInSideAllowed).mockResolvedValue(null);
    vi.mocked(assertSameSidePostCloseCooldown).mockResolvedValue(null);
    vi.mocked(getSymbolExposureSnapshot).mockResolvedValue({
      openUsd: 0,
      pendingUsd: 0,
      totalUsd: 0,
      maxExposureUsd: 2000,
      remainingUsd: 2000,
      openSides: [],
      pendingSides: [],
    });
    vi.mocked(checkBinanceAccountTradable).mockResolvedValue({ tradable: true, reason: 'ok' });
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
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);
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
  });

  it('allows same-side scale-in when under exposure cap', async () => {
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 10000,
    } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([
      { side: 'long', size_usd: 700 },
    ] as never);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);
    vi.mocked(getSymbolExposureSnapshot).mockResolvedValue({
      openUsd: 700,
      pendingUsd: 0,
      totalUsd: 700,
      maxExposureUsd: 2000,
      remainingUsd: 1300,
      openSides: ['long'],
      pendingSides: [],
    });
    vi.mocked(normalizeQuantityForSymbol).mockResolvedValue({
      rawQty: 0.01,
      normalizedQty: 0.01,
      stepSize: 0.0001,
      minQty: 0.0001,
      valid: true,
    });
    vi.mocked(initTestnetClient).mockReturnValue({} as never);
    vi.mocked(placeLimitOrder).mockResolvedValue({ orderId: 999 } as never);
    vi.mocked(createTestnetPendingOrder).mockResolvedValue({ order_id: 'v3_scale' } as never);

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

    expect(result.success).toBe(true);
    expect(placeLimitOrder).toHaveBeenCalled();
  });

  it('rejects same-side open when scale-in disabled', async () => {
    vi.mocked(isV3ScaleInEnabled).mockReturnValue(false);
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 10000,
    } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([
      { side: 'long', size_usd: 500 },
    ] as never);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);

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

  it('rejects opposite side when scale-in enabled', async () => {
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 10000,
    } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([
      { side: 'short', size_usd: 700 },
    ] as never);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);

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
    expect(result.reason).toContain('Opposite');
    expect(placeLimitOrder).not.toHaveBeenCalled();
  });

  it('rejects when assertScaleInSideAllowed blocks (Binance same-side, scale-in off)', async () => {
    vi.mocked(isV3ScaleInEnabled).mockReturnValue(false);
    vi.mocked(assertScaleInSideAllowed).mockResolvedValue(
      'Binance already has long exposure for BTC (scaling-in disabled)'
    );
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 10000,
    } as never);

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

  it('rejects when same-side post-close cooldown active', async () => {
    vi.mocked(assertSameSidePostCloseCooldown).mockResolvedValue(
      'same-side long cooldown 60m after loss (180m window)'
    );
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 10000,
    } as never);

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
    expect(result.reason).toContain('same-side long cooldown');
    expect(placeLimitOrder).not.toHaveBeenCalled();
  });

  it('rejects at max exposure even with scale-in', async () => {
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 10000,
    } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([
      { side: 'short', size_usd: 2000 },
    ] as never);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);
    vi.mocked(getSymbolExposureSnapshot).mockResolvedValue({
      openUsd: 2000,
      pendingUsd: 0,
      totalUsd: 2000,
      maxExposureUsd: 2000,
      remainingUsd: 0,
      openSides: ['short'],
      pendingSides: [],
    });

    const result = await executeV3Trade({
      symbol: 'BTC',
      timeframe: '1h',
      analysis: {
        bias: 'bearish',
        action: 'sell',
        confidence: 0.9,
        suggested_entry: 100000,
        suggested_stop_loss: 101000,
        suggested_take_profit: 98000,
      },
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain('Max exposure');
  });

  it('rejects scale-in when headroom below Binance min notional', async () => {
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 5000,
    } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([
      { side: 'long', size_usd: 736 },
    ] as never);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);
    vi.mocked(getSymbolExposureSnapshot).mockResolvedValue({
      openUsd: 736,
      pendingUsd: 0,
      totalUsd: 736,
      maxExposureUsd: 750,
      remainingUsd: 14,
      openSides: ['long'],
      pendingSides: [],
    });

    const result = await executeV3Trade({
      symbol: 'BTC',
      timeframe: '1h',
      analysis: {
        bias: 'bullish',
        action: 'buy',
        confidence: 0.9,
        suggested_entry: 64500,
        suggested_stop_loss: 63950,
        suggested_take_profit: 65700,
      },
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain('below Binance min order');
    expect(placeLimitOrder).not.toHaveBeenCalled();
  });

  it('accepts floored qty slightly below min notional (40U wallet scenario)', async () => {
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 40,
    } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([]);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);
    vi.mocked(initTestnetClient).mockReturnValue({} as never);
    vi.mocked(normalizeQuantityForSymbol).mockResolvedValue({
      rawQty: 200 / 64380,
      normalizedQty: 0.003,
      stepSize: 0.001,
      minQty: 0.001,
      valid: true,
    });
    vi.mocked(placeLimitOrder).mockResolvedValue({ orderId: 77777 } as never);
    vi.mocked(createTestnetPendingOrder).mockResolvedValue({ order_id: 'v3_tol' } as never);

    const result = await executeV3Trade({
      symbol: 'BTC',
      timeframe: '15m',
      analysis: {
        bias: 'bullish',
        action: 'buy',
        confidence: 0.92,
        suggested_entry: 64380,
        suggested_stop_loss: 63630,
        suggested_take_profit: 66480,
      },
    });

    expect(result.success).toBe(true);
    expect(placeLimitOrder).toHaveBeenCalledWith(
      expect.anything(),
      'BTCUSDT',
      'BUY',
      0.003,
      64380,
      'OPEN',
      null,
      null,
      expect.any(String)
    );
  });
});

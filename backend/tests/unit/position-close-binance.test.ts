import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnsurePositionModeDetected = vi.hoisted(() => vi.fn());
const mockGetPositionMode = vi.hoisted(() => vi.fn(() => 'ONE_WAY' as const));
const mockNormalizeQuantityForSymbol = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ valid: true, normalizedQty: 0.0119 }))
);
const mockPlaceMarketOrder = vi.hoisted(() => vi.fn(() => Promise.resolve({ orderId: 1 })));

vi.mock('../../src/services/binance-hedge-mode', () => ({
  ensurePositionModeDetected: mockEnsurePositionModeDetected,
  getPositionMode: mockGetPositionMode,
}));

vi.mock('../../src/services/binanceClient', () => ({
  normalizeQuantityForSymbol: mockNormalizeQuantityForSymbol,
  placeMarketOrder: mockPlaceMarketOrder,
}));

import { closePositionOnBinanceMarket } from '../../src/services/position-close.service';

describe('closePositionOnBinanceMarket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BINANCE_ENABLED = 'true';
    mockGetPositionMode.mockReturnValue('ONE_WAY');
  });

  it('does not send positionSide in ONE_WAY mode', async () => {
    const result = await closePositionOnBinanceMarket({
      symbol: 'BTC',
      side: 'short',
      size_qty: 0.0119,
    });

    expect(result.ok).toBe(true);
    expect(mockPlaceMarketOrder).toHaveBeenCalledWith(
      {},
      'BTCUSDT',
      'BUY',
      0.0119,
      'CLOSE',
      { positionAmt: -0.0119 },
      null
    );
  });

  it('returns ok:false when market order fails', async () => {
    mockPlaceMarketOrder.mockRejectedValueOnce(new Error('Binance API Error -1109: Invalid account.'));

    const result = await closePositionOnBinanceMarket({
      symbol: 'BTC',
      side: 'short',
      size_qty: 0.0119,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('-1109');
  });

  it('sends positionSide in HEDGE mode', async () => {
    mockGetPositionMode.mockReturnValue('HEDGE');

    await closePositionOnBinanceMarket({
      symbol: 'BTC',
      side: 'short',
      size_qty: 0.0119,
    });

    expect(mockPlaceMarketOrder).toHaveBeenCalledWith(
      {},
      'BTCUSDT',
      'BUY',
      0.0119,
      'CLOSE',
      { positionAmt: -0.0119, positionSide: 'SHORT' },
      null
    );
  });
});

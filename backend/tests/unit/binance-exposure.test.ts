import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/binance/account', () => ({
  getPositionRisk: vi.fn(),
}));

vi.mock('../../src/services/binance/trading', () => ({
  getUserTrades: vi.fn(),
  getOpenAlgoOrders: vi.fn(),
}));

import { getPositionRisk } from '../../src/services/binance/account';
import { getUserTrades, getOpenAlgoOrders } from '../../src/services/binance/trading';
import {
  clearBinancePositionRiskState,
  fetchActiveBinancePositions,
  fetchBinancePositionRiskRows,
  hasBinanceExposureForSide,
  inferBinancePositionsFromFallback,
  isBinancePositionRiskUnavailable,
} from '../../src/services/binance-exposure.service';

function demo1109Error(): Error & { binanceCode: number } {
  const error = new Error('Binance API Error -1109: Invalid account.') as Error & {
    binanceCode: number;
  };
  error.binanceCode = -1109;
  return error;
}

describe('binance-exposure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearBinancePositionRiskState();
    process.env.BINANCE_BASE_URL = 'https://demo-fapi.binance.com';
  });

  it('returns positionRisk rows when API succeeds', async () => {
    vi.mocked(getPositionRisk).mockResolvedValue([
      {
        symbol: 'BTCUSDT',
        positionAmt: 0.02,
        entryPrice: 100000,
        markPrice: 100100,
        unRealizedProfit: 0,
        liquidationPrice: 0,
        leverage: 10,
        maxNotionalValue: 0,
        marginType: 'cross',
        isolatedMargin: 0,
        isAutoAddMargin: false,
        positionSide: 'BOTH',
        notional: 0,
        isolatedWallet: 0,
      },
    ]);

    const rows = await fetchBinancePositionRiskRows('BTC');
    expect(rows).toHaveLength(1);
    expect(isBinancePositionRiskUnavailable()).toBe(false);
    expect(getUserTrades).not.toHaveBeenCalled();
  });

  it('falls back to userTrades net position on demo -1109', async () => {
    vi.mocked(getPositionRisk).mockRejectedValue(demo1109Error());
    vi.mocked(getUserTrades).mockResolvedValue([
      { side: 'BUY', qty: 0.02, price: 99500, time: 1, orderId: 1 },
      { side: 'SELL', qty: 0.01, price: 100000, time: 2, orderId: 2 },
    ] as never);

    const active = await fetchActiveBinancePositions('BTC');
    expect(isBinancePositionRiskUnavailable()).toBe(true);
    expect(active).toHaveLength(1);
    expect(active[0].side).toBe('long');
    expect(active[0].positionAmt).toBeCloseTo(0.01, 6);
  });

  it('strict mode returns empty on demo -1109 without userTrades', async () => {
    vi.mocked(getPositionRisk).mockRejectedValue(demo1109Error());

    const active = await fetchActiveBinancePositions('BTC', {
      allowUserTradesFallback: false,
    });
    expect(isBinancePositionRiskUnavailable()).toBe(true);
    expect(active).toHaveLength(0);
    expect(getUserTrades).not.toHaveBeenCalled();
  });

  it('falls back to protective algo orders when userTrades net is flat', async () => {
    vi.mocked(getUserTrades).mockResolvedValue([
      { side: 'BUY', qty: 0.02, price: 99500, time: 1, orderId: 1 },
      { side: 'SELL', qty: 0.02, price: 100000, time: 2, orderId: 2 },
    ] as never);
    vi.mocked(getOpenAlgoOrders).mockResolvedValue([
      {
        side: 'SELL',
        orderType: 'STOP_MARKET',
        quantity: 0.02,
        triggerPrice: 99000,
      },
    ] as never);

    const active = await inferBinancePositionsFromFallback('BTC');
    expect(active).toHaveLength(1);
    expect(active[0].side).toBe('long');
    expect(active[0].positionAmt).toBe(0.02);
  });

  it('hasBinanceExposureForSide uses fallback on demo -1109', async () => {
    vi.mocked(getPositionRisk).mockRejectedValue(demo1109Error());
    vi.mocked(getUserTrades).mockResolvedValue([
      { side: 'SELL', qty: 0.03, price: 100500, time: 1, orderId: 1 },
    ] as never);

    const exposed = await hasBinanceExposureForSide('BTC', 'short');
    expect(exposed).toBe(true);
  });
});

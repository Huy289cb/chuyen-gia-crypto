import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/binance-exposure.service', () => ({
  fetchActiveBinancePositions: vi.fn(),
}));

vi.mock('../../src/services/binance/trading', () => ({
  getOpenOrders: vi.fn(),
  getOpenAlgoOrders: vi.fn(),
}));

import { fetchActiveBinancePositions } from '../../src/services/binance-exposure.service';
import { getOpenOrders, getOpenAlgoOrders } from '../../src/services/binance/trading';
import {
  getBinanceOpenPositionLines,
  getBinancePendingOrderLines,
  enrichPositionsWithBinanceSlTp,
} from '../../src/services/account-summary.service';

describe('account-summary Binance live', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps Binance positionRisk to open lines', async () => {
    vi.mocked(fetchActiveBinancePositions).mockResolvedValue([
      {
        symbol: 'BTC',
        symbolUsdt: 'BTCUSDT',
        side: 'short',
        positionAmt: 0.0112,
        entryPrice: 66638,
        markPrice: 65750,
        unRealizedProfit: 9.87,
        notional: -736.4,
        rawPositionSide: 'BOTH',
      },
    ]);

    const lines = await getBinanceOpenPositionLines('BTC');
    expect(lines).toHaveLength(1);
    expect(lines[0].side).toBe('short');
    expect(lines[0].sizeQty).toBe(0.0112);
    expect(lines[0].sizeUsd).toBeCloseTo(736.4, 0);
    expect(lines[0].unrealizedPnl).toBeCloseTo(9.87, 2);
    expect(fetchActiveBinancePositions).toHaveBeenCalledWith('BTC', {
      allowUserTradesFallback: false,
    });
  });

  it('maps Binance open limit orders', async () => {
    vi.mocked(getOpenOrders).mockResolvedValue([
      {
        orderId: 123,
        symbol: 'BTCUSDT',
        side: 'SELL',
        type: 'LIMIT',
        status: 'NEW',
        price: 70000,
        quantity: 0.01,
      },
    ] as never);

    const lines = await getBinancePendingOrderLines('BTC');
    expect(lines).toHaveLength(1);
    expect(lines[0].side).toBe('short');
    expect(lines[0].entry).toBe(70000);
  });

  it('attaches SL/TP from open algo orders', async () => {
    vi.mocked(getOpenAlgoOrders).mockResolvedValue([
      { orderType: 'STOP_MARKET', triggerPrice: 68000 },
      { orderType: 'TAKE_PROFIT_MARKET', triggerPrice: 64000 },
    ] as never);

    const enriched = await enrichPositionsWithBinanceSlTp(
      [
        {
          positionId: 'binance-BTC-short',
          symbol: 'BTC',
          side: 'short',
          entry: 66000,
          mark: 65500,
          unrealizedPnl: 5,
          sizeUsd: 700,
          sizeQty: 0.01,
        },
      ],
      'BTC'
    );
    expect(enriched[0].stopLoss).toBe(68000);
    expect(enriched[0].takeProfit).toBe(64000);
  });
});

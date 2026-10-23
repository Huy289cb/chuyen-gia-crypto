import { describe, it, expect, vi, beforeEach } from 'vitest';
import { estimatePnl, resolveClosePnlFromUserTrades } from '../../src/services/binance-fill-pnl.service';

vi.mock('../../src/services/binance/trading', () => ({
  getUserTrades: vi.fn(),
}));

vi.mock('../../src/services/binance-income.service', () => ({ fetchBinanceIncomeRows: vi.fn().mockResolvedValue([]) }));

import { getUserTrades } from '../../src/services/binance/trading';

describe('binance-fill-pnl qty match', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BINANCE_ENABLED = 'true';
  });

  it('rejects verified PnL when aggregated close qty mismatches position size', async () => {
    vi.mocked(getUserTrades).mockResolvedValue([
      { tradeId: 1, orderId: 1, side: 'SELL', qty: 0.02, price: 100, commission: 0.01, realizedPnl: 0, time: 1000 },
      { tradeId: 2, orderId: 2, side: 'BUY', qty: 0.02, price: 110, commission: 0.01, realizedPnl: -0.2, time: 2000 },
    ]);

    const fill = await resolveClosePnlFromUserTrades({
      symbol: 'BTC',
      side: 'short',
      entryTime: new Date(1000),
      closeTime: new Date(2000),
      entryOrderId: '1',
      sizeQty: 0.0112,
      entryPrice: 62940,
      fallbackClosePrice: 66464,
    });

    expect(fill.verified).toBe(false);
    expect(fill.realizedPnl).toBeCloseTo(estimatePnl('short', 62940, 66464, 0.0112), 2);
  });
});

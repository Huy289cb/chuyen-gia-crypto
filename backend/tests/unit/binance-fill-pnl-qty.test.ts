import { describe, it, expect, vi, beforeEach } from 'vitest';
import { estimatePnl, resolveClosePnlFromUserTrades } from '../../src/services/binance-fill-pnl.service';

vi.mock('../../src/services/binance/trading', () => ({
  getUserTrades: vi.fn(),
}));

import { getUserTrades } from '../../src/services/binance/trading';

describe('binance-fill-pnl qty match', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BINANCE_ENABLED = 'true';
  });

  it('rejects verified PnL when aggregated close qty mismatches position size', async () => {
    vi.mocked(getUserTrades).mockResolvedValue([
      { orderId: 1, side: 'SELL', qty: 0.0112, price: 62940, commission: 0, realizedPnl: 0, time: 1 },
      { orderId: 2, side: 'BUY', qty: 0.0112, price: 66178, commission: 0, realizedPnl: 0, time: 2 },
      { orderId: 3, side: 'BUY', qty: 0.0112, price: 67120, commission: 0, realizedPnl: 0, time: 3 },
      { orderId: 4, side: 'BUY', qty: 0.0112, price: 66733, commission: 0, realizedPnl: 0, time: 4 },
      { orderId: 5, side: 'BUY', qty: 0.0111, price: 66464, commission: 0, realizedPnl: 0, time: 5 },
    ] as never);

    const fill = await resolveClosePnlFromUserTrades({
      symbol: 'BTC',
      side: 'short',
      entryTime: new Date('2026-06-15T06:29:52.781Z'),
      closeTime: new Date('2026-06-16T14:45:13.465Z'),
      entryOrderId: '15002026111',
      sizeQty: 0.0112,
      entryPrice: 62940,
      fallbackClosePrice: 66464,
    });

    expect(fill.verified).toBe(false);
    expect(fill.realizedPnl).toBeCloseTo(estimatePnl('short', 62940, 66464, 0.0112), 2);
  });
});

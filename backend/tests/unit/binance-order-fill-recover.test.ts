import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/repositories/testnet.repository', () => ({
  updateTestnetPendingOrder: vi.fn(),
  executeTestnetPendingOrder: vi.fn(),
  createTestnetPosition: vi.fn(),
  findTestnetPositionByBinanceOrderId: vi.fn(),
  getTestnetPendingOrderByBinanceId: vi.fn(),
  recordTestnetTradeEvent: vi.fn(),
}));

vi.mock('../../src/services/protective-order.service', () => ({
  placeProtectiveOrdersForPosition: vi.fn(),
  resolveLevelsForFill: vi.fn(),
}));

const getOrder = vi.fn();

vi.mock('../../src/services/binance/trading', () => ({
  getOrder: (...args: unknown[]) => getOrder(...args),
}));

import { recoverPendingOrderFromBinance } from '../../src/services/binance-order-fill.service';

describe('recoverPendingOrderFromBinance', () => {
  const baseOrder = {
    order_id: 'v3_test',
    account_id: 1,
    symbol: 'BTC',
    side: 'long',
    entry_price: 64000,
    stop_loss: 63000,
    take_profit: 66000,
    risk_usd: 50,
    risk_percent: 1,
    expected_rr: 2,
    binance_order_id: '999',
    status: 'pending',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns api_unavailable on demo -1109 instead of failed', async () => {
    getOrder.mockRejectedValue(new Error('Binance API Error -1109: Invalid account.'));

    const outcome = await recoverPendingOrderFromBinance(baseOrder);

    expect(outcome).toBe('api_unavailable');
  });

  it('returns cancelled when Binance reports CANCELED', async () => {
    getOrder.mockResolvedValue({
      status: 'CANCELED',
      executedQty: 0,
      cummulativeQuoteQty: 0,
      price: 64000,
    });

    const outcome = await recoverPendingOrderFromBinance(baseOrder);

    expect(outcome).toBe('cancelled');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../src/services/binance/client', () => ({ post: vi.fn(), get: vi.fn(), del: vi.fn() }));
import { post } from '../../src/services/binance/client';
import { placeStopMarketOrder, placeTakeProfitMarketOrder } from '../../src/services/binance/trading';
describe('algo response normalization evidence', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([{ place: placeStopMarketOrder, type: 'STOP_MARKET' }, { place: placeTakeProfitMarketOrder, type: 'TAKE_PROFIT_MARKET' }])('retains authoritative response for $type without changing legacy fields', async ({ place, type }) => {
    vi.mocked(post).mockResolvedValue({ algoId: 123, symbol: 'BTCUSDT', side: 'SELL', orderType: type,
      quantity: '0.001', triggerPrice: '62500', algoStatus: 'NEW', workingType: 'CONTRACT_PRICE', reduceOnly: true });
    const result = await place({ symbol: 'BTCUSDT', side: 'SELL', quantity: '0.001', stopPrice: '62500', reduceOnly: true });
    expect(post).toHaveBeenCalledOnce();
    expect(vi.mocked(post).mock.calls[0][1]).toEqual({ symbol: 'BTCUSDT', side: 'SELL', quantity: '0.001',
      triggerPrice: '62500', timeInForce: 'GTC', algoType: 'CONDITIONAL', type, reduceOnly: true });
    expect(result.orderId).toBe(123); expect(result.type).toBe(type);
    expect(result.stopPrice).toBeNull(); expect(Number.isNaN(result.origQty)).toBe(true);
    const evidence = JSON.parse(JSON.stringify(result.algo_contract_evidence));
    expect(evidence.request.type).toBe(type); expect(evidence.response.orderType).toBe(type);
    expect(evidence.response.quantity).toBe('0.001'); expect(evidence.response.triggerPrice).toBe('62500');
    expect(evidence.response.algoStatus).toBe('NEW'); expect(evidence.request.workingType).toBeNull();
  });
});

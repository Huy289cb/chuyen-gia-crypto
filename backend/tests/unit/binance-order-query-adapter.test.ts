import { beforeEach, describe, expect, it, vi } from 'vitest';
const get = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/binance/client', () => ({ get, post: vi.fn(), del: vi.fn() }));
import { getOrder } from '../../src/services/binance/trading';

describe('Futures order query fill normalization', () => {
  beforeEach(() => vi.clearAllMocks());
  it('preserves actual cumulative quote and average rather than the submitted limit price', async () => {
    get.mockResolvedValue({ orderId: 999, symbol: 'BTCUSDT', status: 'CANCELED',
      price: '64000', origQty: '0.003', executedQty: '0.002', cumQuote: '127.8', avgPrice: '63900' });
    const order = await getOrder('BTCUSDT', 999);
    expect(order.executedQty).toBe(0.002);
    expect(order.cummulativeQuoteQty / order.executedQty).toBe(63900);
    expect(order.avgPrice).toBe(63900);
    expect(order.price).toBe(64000);
  });
  it('retains legacy cumulative quote responses', async () => {
    get.mockResolvedValue({ cummulativeQuoteQty: '127.8', executedQty: '0.002', price: '64000' });
    expect((await getOrder('BTCUSDT', 999)).cummulativeQuoteQty).toBe(127.8);
  });
  it('does not invent zero quote or average when execution evidence is absent', async () => {
    get.mockResolvedValue({ executedQty: '0.002', price: '64000' });
    const order = await getOrder('BTCUSDT', 999);
    expect(Number.isNaN(order.cummulativeQuoteQty)).toBe(true);
    expect(Number.isNaN(order.avgPrice)).toBe(true);
  });
});

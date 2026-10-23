import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn(), fills: vi.fn() }));
vi.mock('../../src/lib/prisma', () => ({ prisma: { testnetPosition: {
  findMany: mocks.findMany, updateMany: mocks.updateMany,
} } }));
vi.mock('../../src/services/binance-trade-history.service', () => ({ fetchUserTradesByTimeWindows: mocks.fills }));
import { reconcileOpenEntryFees } from '../../src/services/open-entry-fee-reconcile.service';
const position = { position_id: 'p1', symbol: 'BTC', side: 'long', size_qty: .001,
  entry_time: new Date('2026-09-07T22:11:31Z'), binance_order_id: '1129402091466', entry_fee: 0 };
const fill = { tradeId: 1, orderId: 1129402091466, side: 'BUY', qty: .001,
  commission: .01583375, commissionAsset: 'USDT', price: 79168.8, realizedPnl: 0, time: 1788819089080 };
describe('open entry commission reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv('BINANCE_ENABLED', 'true');
    mocks.findMany.mockResolvedValue([{ ...position }]); mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.fills.mockResolvedValue([fill, { ...fill, orderId: 222, commission: 5 }]);
  });
  afterEach(() => vi.unstubAllEnvs());
  it('uses only the matched order and changes fee metadata without debiting the wallet again', async () => {
    expect(await reconcileOpenEntryFees(1)).toBe(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({
      position_id: 'p1', status: 'open', partial_closed: 0, size_qty: .001, entry_fee: 0,
    }), data: { entry_fee: .01583375 } });
  });
  it('sums split fills and does not write the same verified fee again', async () => {
    mocks.fills.mockResolvedValue([{...fill,qty:.0004,commission:.006}, {...fill,tradeId:2,qty:.0006,commission:.00983375}]);
    expect(await reconcileOpenEntryFees(1)).toBe(1);
    mocks.findMany.mockResolvedValue([{ ...position, entry_fee: .01583375 }]);
    mocks.updateMany.mockClear();
    expect(await reconcileOpenEntryFees(1)).toBe(0); expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it.each([{qty:.0005}, {side:'SELL'}, {commissionAsset:'BNB'}, {commission:NaN}])('keeps unverifiable fee unchanged: %j', async override => {
    mocks.fills.mockResolvedValue([{...fill,...override}]);
    expect(await reconcileOpenEntryFees(1)).toBe(0); expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it('does not overwrite a position that closes during the exchange read', async () => {
    mocks.updateMany.mockResolvedValue({count:0});expect(await reconcileOpenEntryFees(1)).toBe(0);
    expect(mocks.updateMany.mock.calls[0][0].where.status).toBe('open');
  });
  it('does not fabricate zero fees on exchange errors', async () => {
    mocks.fills.mockRejectedValue(new Error('temporary exchange error'));
    expect(await reconcileOpenEntryFees(1)).toBe(0);expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it('does no work when Binance is disabled', async () => {
    vi.stubEnv('BINANCE_ENABLED','false');expect(await reconcileOpenEntryFees(1)).toBe(0);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});

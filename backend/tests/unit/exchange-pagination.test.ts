import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/services/binance/trading', () => ({ getUserTrades: vi.fn() }));
vi.mock('../../src/services/binance/client', () => ({ get: vi.fn() }));
import { getUserTrades } from '../../src/services/binance/trading';
import { get } from '../../src/services/binance/client';
import { fetchUserTradesByTimeWindows } from '../../src/services/binance-trade-history.service';
import { fetchBinanceIncomeRows } from '../../src/services/binance-income.service';
import { resolveClosePnlFromUserTrades } from '../../src/services/binance-fill-pnl.service';
const row = (id: number, time = id) => ({ tradeId: id, orderId: id, side: 'BUY', price: 100, qty: 1, commission: 0.01, realizedPnl: 0, time });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('BINANCE_ENABLED', 'true'); });
afterEach(() => vi.unstubAllEnvs());
describe('complete exchange windows', () => {
  it('subdivides a saturated window without dropping fills', async () => {
    const all = Array.from({ length: 1005 }, (_, i) => row(i + 1));
    vi.mocked(getUserTrades).mockImplementation(async (_symbol, opts: any) => all.filter(r => r.time >= opts.startTime && r.time <= opts.endTime).slice(0, 1000));
    expect(await fetchUserTradesByTimeWindows('BTCUSDT', 1010, 1010)).toHaveLength(1005);
    expect(getUserTrades).toHaveBeenCalledTimes(3);
  });
  it('refuses a saturated single millisecond instead of silently advancing past fills', async () => {
    vi.mocked(getUserTrades).mockResolvedValue(Array.from({ length: 1000 }, (_, i) => row(i, 1)));
    await expect(fetchUserTradesByTimeWindows('BTCUSDT', 1, 1)).rejects.toThrow('saturated');
  });
  it('pages income with fixed bounds even when 1001 rows share one timestamp', async () => {
    const incomes = Array.from({ length: 1001 }, (_, i) => ({ tranId: i, incomeType: 'FUNDING_FEE', income: '-0.01', asset: 'USDT', time: 100 }));
    vi.mocked(get).mockResolvedValueOnce(incomes.slice(0, 1000)).mockResolvedValueOnce(incomes.slice(1000));
    expect(await fetchBinanceIncomeRows({ startTime: 0, endTime: 200 })).toHaveLength(1001);
    expect(vi.mocked(get).mock.calls[1][1]).toMatchObject({ page: '2', startTime: '0', endTime: '200' });
  });
  it('anchors net zero-gross closes by entry order despite delayed local materialization', async () => {
    vi.mocked(getUserTrades).mockResolvedValue([row(1, 1000), { ...row(2, 2000), side: 'SELL' }]);
    vi.mocked(get).mockResolvedValue([]);
    const result = await resolveClosePnlFromUserTrades({ symbol: 'BTC', side: 'long', entryTime: new Date(1500), closeTime: new Date(2000),
      entryOrderId: '1', sizeQty: 1, entryPrice: 100, fallbackClosePrice: 200 });
    expect(result.verified).toBe(true); expect(result.realizedPnl).toBeCloseTo(-0.02);
    expect(result.tradeIds).toEqual([1, 2]); expect(result.closePrice).toBe(100);
  });
});

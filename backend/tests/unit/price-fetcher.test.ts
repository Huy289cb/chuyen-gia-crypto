import { beforeEach, describe, expect, it, vi } from 'vitest';

const getKlinesMock = vi.fn();

vi.mock('../../src/services/binance/market', () => ({
  getKlines: (...args: unknown[]) => getKlinesMock(...args),
}));

vi.mock('../../src/services/binance/config', () => ({
  config: { BASE_URL: 'https://demo-fapi.binance.com' },
}));

function sampleKline(close: number, openTime = 1_700_000_000_000) {
  return {
    openTime,
    open: close - 50,
    high: close + 100,
    low: close - 100,
    close,
    volume: 12.5,
    closeTime: openTime + 59_999,
    quoteVolume: 900_000,
    trades: 42,
    takerBuyBaseVolume: 6,
    takerBuyQuoteVolume: 450_000,
  };
}

describe('price-fetcher (Binance Futures)', () => {
  beforeEach(() => {
    getKlinesMock.mockReset();
  });

  it('fetchRealTimePrices uses USD-M futures klines for BTC and ETH', async () => {
    getKlinesMock
      .mockResolvedValueOnce([sampleKline(65_000)])
      .mockResolvedValueOnce([sampleKline(3_500)]);

    const { fetchRealTimePrices } = await import('../../src/services/price-fetcher');
    const prices = await fetchRealTimePrices();

    expect(getKlinesMock).toHaveBeenCalledWith('BTCUSDT', '1m', 1);
    expect(getKlinesMock).toHaveBeenCalledWith('ETHUSDT', '1m', 1);
    expect(prices.btc.price).toBe(65_000);
    expect(prices.eth?.price).toBe(3_500);
  });

  it('fetchHistoricalCandles appends USDT and returns raw kline rows', async () => {
    getKlinesMock.mockResolvedValueOnce([sampleKline(64_321)]);

    const { fetchHistoricalCandles } = await import('../../src/services/price-fetcher');
    const rows = await fetchHistoricalCandles('BTC', '15m', 1);

    expect(getKlinesMock).toHaveBeenCalledWith('BTCUSDT', '15m', 1);
    expect(rows).toHaveLength(1);
    expect(rows[0][4]).toBe(64_321);
  });

  it('fetchHistoricalCandlesPaginated paginates with endTime when totalLimit exceeds page size', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => sampleKline(60_000 + i, (i + 1) * 1_000));
    const page2 = [sampleKline(59_000, 500)];

    getKlinesMock.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

    const { fetchHistoricalCandlesPaginated } = await import('../../src/services/price-fetcher');
    const rows = await fetchHistoricalCandlesPaginated('BTC', '5m', 1001);

    expect(getKlinesMock).toHaveBeenNthCalledWith(1, 'BTCUSDT', '5m', 1000, null, null);
    expect(getKlinesMock).toHaveBeenNthCalledWith(2, 'BTCUSDT', '5m', 1, null, 999);
    expect(rows).toHaveLength(1001);
    expect(rows[0][4]).toBe(59_000);
    expect(rows[1000][4]).toBe(60_999);
  });
});

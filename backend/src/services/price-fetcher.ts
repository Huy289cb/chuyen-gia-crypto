/**
 * Price Fetcher Service (TypeScript)
 *
 * Primary source: Binance USD-M Futures (BINANCE_BASE_URL — demo-fapi or fapi)
 * Secondary source: Database OHLCV candles
 */

import { getKlines } from './binance/market';
import { config as binanceConfig } from './binance/config';

type FuturesKline = Awaited<ReturnType<typeof getKlines>>[number];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toFuturesSymbol(coinOrSymbol: string): string {
  const s = coinOrSymbol.toUpperCase();
  return s.endsWith('USDT') ? s : `${s}USDT`;
}

/** Raw kline array shape returned by Binance REST (for legacy callers). */
function klineToRawRow(k: FuturesKline): number[] {
  return [
    k.openTime,
    k.open,
    k.high,
    k.low,
    k.close,
    k.volume,
    k.closeTime,
    k.quoteVolume,
    k.trades,
    k.takerBuyBaseVolume,
    k.takerBuyQuoteVolume,
  ];
}

function klineToCandle(k: FuturesKline): CandleData {
  return {
    price: k.close,
    open: k.open,
    high: k.high,
    low: k.low,
    volume: k.volume,
    time: new Date(k.openTime).toISOString(),
  };
}

export interface CandleData {
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  time: string;
}

export interface PriceData {
  timestamp: string;
  btc: CandleData;
  eth?: CandleData;
}

/**
 * Fetch real-time 1-minute candle data from Binance USD-M Futures.
 */
export async function fetchRealTimePrices(): Promise<PriceData> {
  const maxRetries = 3;
  const retryDelay = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const [btcKlines, ethKlines] = await Promise.all([
        getKlines('BTCUSDT', '1m', 1),
        getKlines('ETHUSDT', '1m', 1),
      ]);

      if (btcKlines.length === 0 || ethKlines.length === 0) {
        throw new Error('Binance futures klines returned empty');
      }

      return {
        timestamp: new Date().toISOString(),
        btc: klineToCandle(btcKlines[0]),
        eth: klineToCandle(ethKlines[0]),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[PriceFetcher] Futures 1m candle fetch failed (attempt ${attempt}/${maxRetries}, base=${binanceConfig.BASE_URL}):`,
        message
      );

      if (attempt < maxRetries) {
        await delay(retryDelay);
        continue;
      }

      throw error;
    }
  }

  throw new Error('Failed to fetch prices after all retries');
}

/**
 * Fetch prices from database (fallback for analysis)
 */
export async function fetchPricesFromDb(coin: string = 'BTC'): Promise<CandleData | null> {
  const { getLatestPrice } = await import('../repositories/market.repository');
  const latestPrice = await getLatestPrice(coin);

  if (latestPrice) {
    return {
      price: latestPrice.price,
      open: latestPrice.price,
      high: latestPrice.price,
      low: latestPrice.price,
      volume: latestPrice.volume_24h || 0,
      time: latestPrice.updated_at.toISOString(),
    };
  }

  return null;
}

/**
 * Fetch historical OHLCV candles from Binance USD-M Futures.
 */
export async function fetchHistoricalCandles(
  symbol: string,
  interval: string = '15m',
  limit: number = 100
): Promise<number[][]> {
  const maxRetries = 3;
  const retryDelay = 1000;
  const futuresSymbol = toFuturesSymbol(symbol);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const klines = await getKlines(futuresSymbol, interval, limit);
      return klines.map(klineToRawRow);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[PriceFetcher] Futures historical candles fetch failed (attempt ${attempt}/${maxRetries}):`,
        message
      );

      if (attempt < maxRetries) {
        await delay(retryDelay);
        continue;
      }

      throw error;
    }
  }

  throw new Error('Failed to fetch historical candles after all retries');
}

const BINANCE_KLINES_MAX = 1000;

/**
 * Fetch up to totalLimit historical klines from Binance Futures (paginated backwards).
 * Returns ascending rows: [openTime, open, high, low, close, volume, ...].
 */
export async function fetchHistoricalCandlesPaginated(
  symbol: string,
  interval: string,
  totalLimit: number
): Promise<number[][]> {
  if (totalLimit <= 0) return [];

  const futuresSymbol = toFuturesSymbol(symbol);
  const byOpenTime = new Map<number, number[]>();
  let endTime: number | undefined = undefined;
  const pageDelayMs = 250;

  while (byOpenTime.size < totalLimit) {
    const pageSize = Math.min(BINANCE_KLINES_MAX, totalLimit - byOpenTime.size);
    const klines = await getKlines(
      futuresSymbol,
      interval,
      pageSize,
      null,
      endTime ?? null
    );

    if (klines.length === 0) break;

    for (const kline of klines) {
      byOpenTime.set(kline.openTime, klineToRawRow(kline));
    }

    const oldestOpen = klines[0].openTime;
    endTime = oldestOpen - 1;

    if (klines.length < pageSize) break;
    await delay(pageDelayMs);
  }

  return Array.from(byOpenTime.values())
    .sort((a, b) => a[0] - b[0])
    .slice(-totalLimit);
}

/**
 * Fetch prices with fallback chain: Binance Futures -> Database
 */
export async function fetchPrices(coin: string = 'BTC'): Promise<CandleData> {
  try {
    const prices = await fetchRealTimePrices();
    const key = coin.toUpperCase() as 'BTC' | 'ETH';
    if (key === 'ETH' && prices.eth) {
      return prices.eth;
    }
    return prices.btc;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[PriceFetcher] Binance futures fetch failed, trying database fallback:', message);

    const dbPrice = await fetchPricesFromDb(coin);
    if (dbPrice) {
      return dbPrice;
    }

    throw new Error('Failed to fetch prices from all sources');
  }
}

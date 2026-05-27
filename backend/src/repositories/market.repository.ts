import { prisma } from '../lib/prisma';

/**
 * Market Data Repository
 * 
 * Handles all database operations for OHLCV candles, latest prices, and price history
 */

export interface OhlcvCandleData {
  coin: string;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  timeframe?: string;
}

export interface LatestPriceData {
  coin: string;
  price: number;
  change24h?: number;
  change7d?: number;
  marketCap?: number;
  volume24h?: number;
}

/**
 * Save or update OHLCV candle
 */
export async function saveOhlcvCandle(data: OhlcvCandleData): Promise<number> {
  const { coin, timestamp, open, high, low, close, volume, timeframe = '15m' } = data;

  const candle = await prisma.ohlcvCandle.upsert({
    where: {
      coin_timestamp_timeframe: {
        coin: coin.toUpperCase(),
        timestamp,
        timeframe,
      },
    },
    update: {
      open,
      high,
      low,
      close,
      volume,
    },
    create: {
      coin: coin.toUpperCase(),
      timestamp,
      open,
      high,
      low,
      close,
      volume,
      timeframe,
    },
  });

  return candle.id;
}

export interface SaveOhlcvBatchOptions {
  /** Persist only the newest N bars (default: all). Market scan should pass 2–3. */
  maxBars?: number;
}

/**
 * Batch save OHLCV candles (sequential upserts; keep maxBars small for DB load).
 */
export async function saveOhlcvCandlesBatch(
  candles: OhlcvCandleData[],
  options?: SaveOhlcvBatchOptions
): Promise<number> {
  const maxBars = options?.maxBars;
  const slice =
    maxBars != null && maxBars > 0 && candles.length > maxBars
      ? candles.slice(-maxBars)
      : candles;

  let saved = 0;
  for (const candle of slice) {
    await saveOhlcvCandle(candle);
    saved++;
  }

  return saved;
}

/** Count stored bars for warmup progress / backfill checks. */
export async function countOhlcvCandles(coin: string, timeframe: string): Promise<number> {
  return prisma.ohlcvCandle.count({
    where: {
      coin: coin.toUpperCase(),
      timeframe,
    },
  });
}

/**
 * Get OHLCV candles for a time range
 */
export async function getOhlcvCandles(
  coin: string,
  hoursBack = 168,
  timeframe = '15m'
): Promise<any[]> {
  const since = new Date();
  since.setHours(since.getHours() - hoursBack);

  return prisma.ohlcvCandle.findMany({
    where: {
      coin: coin.toUpperCase(),
      timeframe,
      timestamp: { gte: since },
    },
    orderBy: { timestamp: 'asc' },
  });
}

/**
 * Get latest OHLCV candle
 */
export async function getLatestOhlcvCandle(
  coin: string,
  timeframe = '15m'
): Promise<any | null> {
  return prisma.ohlcvCandle.findFirst({
    where: {
      coin: coin.toUpperCase(),
      timeframe,
    },
    orderBy: { timestamp: 'desc' },
  });
}

/**
 * Save latest price
 */
export async function saveLatestPrice(data: LatestPriceData): Promise<number> {
  const { coin, price, change24h, change7d, marketCap, volume24h } = data;

  const latestPrice = await prisma.latestPrice.upsert({
    where: { coin: coin.toUpperCase() },
    update: {
      price,
      change_24h: change24h,
      change_7d: change7d,
      market_cap: marketCap,
      volume_24h: volume24h,
      updated_at: new Date(),
    },
    create: {
      coin: coin.toUpperCase(),
      price,
      change_24h: change24h,
      change_7d: change7d,
      market_cap: marketCap,
      volume_24h: volume24h,
    },
  });

  return latestPrice.id;
}

/**
 * Get latest price
 */
export async function getLatestPrice(coin: string): Promise<any | null> {
  return prisma.latestPrice.findUnique({
    where: { coin: coin.toUpperCase() },
  });
}

/**
 * Get all latest prices
 */
export async function getAllLatestPrices(): Promise<any[]> {
  return prisma.latestPrice.findMany();
}

/**
 * Save price history entry
 */
export async function savePriceHistory(coin: string, price: number): Promise<number> {
  const priceHistory = await prisma.priceHistory.create({
    data: {
      coin: coin.toUpperCase(),
      price,
      timestamp: new Date(),
    },
  });

  return priceHistory.id;
}

/**
 * Get price history
 */
export async function getPriceHistory(
  coin: string,
  hoursBack = 24
): Promise<any[]> {
  const since = new Date();
  since.setHours(since.getHours() - hoursBack);

  return prisma.priceHistory.findMany({
    where: {
      coin: coin.toUpperCase(),
      timestamp: { gte: since },
    },
    orderBy: { timestamp: 'desc' },
  });
}

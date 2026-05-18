import { fetchPrices, fetchPricesFromDb } from './price-fetcher';
import { getLatestPrice } from '../repositories/market.repository';

export function isLongSide(side: string): boolean {
  return side.toLowerCase() === 'long' || side.toLowerCase() === 'buy';
}

export function calculateUnrealizedPnl(
  side: string,
  entryPrice: number,
  markPrice: number,
  sizeQty: number
): number {
  const raw = (markPrice - entryPrice) * sizeQty;
  return isLongSide(side) ? raw : -raw;
}

/** Price move % in the position's favor (not ROE on margin). */
export function calculatePnlPercent(side: string, entryPrice: number, markPrice: number): number {
  if (entryPrice <= 0 || markPrice <= 0) return 0;
  if (isLongSide(side)) {
    return ((markPrice - entryPrice) / entryPrice) * 100;
  }
  return ((entryPrice - markPrice) / entryPrice) * 100;
}

/** Latest mark for dashboard / position display: DB latest_price → live fetch → fallback. */
export async function resolveMarkPrice(symbol: string, fallback: number): Promise<number> {
  const coin = symbol.toUpperCase().replace(/USDT$/, '');

  try {
    const latest = await getLatestPrice(coin);
    if (latest?.price && Number(latest.price) > 0) {
      return Number(latest.price);
    }
  } catch {
    // continue to live fetch
  }

  try {
    const db = await fetchPricesFromDb(coin);
    if (db?.price && db.price > 0) {
      return db.price;
    }
  } catch {
    // continue
  }

  try {
    const live = await fetchPrices(coin);
    if (live?.price && live.price > 0) {
      return live.price;
    }
  } catch {
    // use fallback
  }

  return fallback > 0 ? fallback : 0;
}

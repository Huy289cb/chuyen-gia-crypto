/**
 * Backfill OHLCV from Binance history when DB warmup count is below target.
 */

import { getV3WarmupRequiredCandles, getV3WarmupTimeframes } from '../config/v3-schedulers';
import {
  countOhlcvCandles,
  saveOhlcvCandlesBatch,
  type OhlcvCandleData,
} from '../repositories/market.repository';
import { fetchHistoricalCandlesPaginated } from './price-fetcher';

export interface OhlcvBackfillTfResult {
  timeframe: string;
  before: number;
  after: number;
  fetched: number;
  saved: number;
  skipped: boolean;
}

export interface OhlcvBackfillResult {
  symbol: string;
  timeframes: OhlcvBackfillTfResult[];
}

const SAVE_CHUNK = 200;

function klinesToBatch(symbol: string, timeframe: string, klines: number[][]): OhlcvCandleData[] {
  return klines.map((k) => ({
    coin: symbol.toUpperCase(),
    timestamp: new Date(k[0]),
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
    volume: parseFloat(String(k[5])),
    timeframe,
  }));
}

/**
 * Pull historical klines from Binance and upsert into DB until targetCount rows exist.
 */
export async function backfillOhlcvTimeframe(
  symbol: string,
  timeframe: string,
  targetCount: number
): Promise<OhlcvBackfillTfResult> {
  const coin = symbol.toUpperCase();
  const before = await countOhlcvCandles(coin, timeframe);

  if (before >= targetCount) {
    return { timeframe, before, after: before, fetched: 0, saved: 0, skipped: true };
  }

  console.log(
    `[OhlcvBackfill] ${coin} ${timeframe}: DB ${before}/${targetCount} — fetching from Binance...`
  );

  const klines = await fetchHistoricalCandlesPaginated(coin, timeframe, targetCount);
  const batch = klinesToBatch(coin, timeframe, klines);

  let saved = 0;
  for (let i = 0; i < batch.length; i += SAVE_CHUNK) {
    const chunk = batch.slice(i, i + SAVE_CHUNK);
    saved += await saveOhlcvCandlesBatch(chunk);
    if (i + SAVE_CHUNK < batch.length) {
      console.log(`[OhlcvBackfill] ${coin} ${timeframe}: saved ${Math.min(i + SAVE_CHUNK, batch.length)}/${batch.length}`);
    }
  }

  const after = await countOhlcvCandles(coin, timeframe);
  console.log(`[OhlcvBackfill] ${coin} ${timeframe}: done ${before} → ${after} (fetched ${klines.length}, upserts ${saved})`);

  return {
    timeframe,
    before,
    after,
    fetched: klines.length,
    saved,
    skipped: false,
  };
}

/** Backfill all V3 gate TFs that are below warmup targets. */
export async function backfillOhlcvIfNeeded(symbol = 'BTC'): Promise<OhlcvBackfillResult> {
  const timeframes = getV3WarmupTimeframes();
  const targets = getV3WarmupRequiredCandles();
  const results: OhlcvBackfillTfResult[] = [];

  for (const tf of timeframes) {
    const target = targets[tf] ?? 100;
    const loaded = await countOhlcvCandles(symbol, tf);
    if (loaded < target) {
      results.push(await backfillOhlcvTimeframe(symbol, tf, target));
    } else {
      results.push({
        timeframe: tf,
        before: loaded,
        after: loaded,
        fetched: 0,
        saved: 0,
        skipped: true,
      });
    }
  }

  return { symbol: symbol.toUpperCase(), timeframes: results };
}

export function isOhlcvBackfillOnStartEnabled(): boolean {
  const v = process.env.V3_OHLCV_BACKFILL_ON_START?.trim().toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'off';
}

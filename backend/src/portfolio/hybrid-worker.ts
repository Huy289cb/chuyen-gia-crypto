import dotenv from 'dotenv';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createDefaultLiveBroker, type LiveBroker, type LiveExchangeInfo, type LivePosition } from './live-broker';
import {
  formatHybridBookNotice,
  formatHybridBreakerNotice,
  formatHybridStopNotice,
  formatHybridPositionClosedNotice,
  formatHybridRatchetNotice,
  formatHybridRebalanceNotice,
  formatHybridTpNotice,
  formatHybridCashFlowNotice,
  formatHybridPruneNotice,
  sendHybridTelegram,
  startHybridTelegramCommandListener,
} from './hybrid-live-notice';
import { SOURCE_MOMENTUM_SYMBOLS } from './market-data';
import { HYBRID_POLICY_ID } from './source-hybrid';
import { DynamicUniverseScanner } from './dynamic-universe';
import { LLMEventShield, type ExchangeContractStatus } from './event-shield';
import {
  DynamicCompoundingManager,
  MOMENTUM_ALLOC_PCT,
  DEFENSIVE_MOMENTUM_ALLOC_PCT,
  BTC_GRID_TICKET_PCT,
} from './dynamic-compounding';
import { VolatilityGridController, type VolatilityGridParams, type CandleData } from './volatility-grid';
import { CashFlowManager, type CashFlowSummary } from './cashflow-manager';
import { atomicWriteFile } from './atomic-fs';

import { getEffectiveMaxExposureUsd, getMainnetMaxLeverage } from '../config/mainnet-safety';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const ICT_OFFSET = 7 * 3_600_000;
const CHECK_INTERVAL_MS = 3_000;
const MOMENTUM_SL_PCT = 0.12;
export const OFFICIAL_RELEASE_VERSION = 'v1.0.4';
export const MOMENTUM_REBALANCE_DAYS = 3; // v1.0.4: 3-day momentum impulse holding
export const BTC_CRASH_HEALTH_GATE_PCT = -0.03; // v1.0.4: BTC Crash Trend Health Gate (-3.0% 1d/24h)
export const BTC_MACRO_BEAR_GATE_PCT = -0.10; // v1.0.4: Macro Bear Defensive Gate (-10.0% 14d BTC -> 1 slot x 25%)
export const FALLING_KNIFE_24H_FLOOR_PCT = -0.15; // v1.0.4: Falling-Knife Guard: reject altcoins dumping <= -15.0% in 24h/intraday
export const PRUNING_DAYS_THRESHOLD = 2.0; // v1.0.4: 2 days (48 hours)
export const PRUNING_MAX_RETURN_THRESH = 0.02; // v1.0.4: Never pumped > +2.0%
export const PRUNING_CURRENT_RETURN_THRESH = -0.05; // v1.0.4: Cut sinking loser early at -5.0% (saving 7% capital)
const BTC_GRID_MAX_LEVELS = 3;
const SAFE_FUTURES_LEVERAGE = 5;
const MOMENTUM_RETRY_INTERVAL_MS = 6 * 3_600_000; // 6 hours
export const PROFIT_LOCK_COOLDOWN_MS = 2 * 3_600_000; // 2 hours for profitable ratchet exits (preserves trend continuation waves)
export const WATCHDOG_TIMEOUT_MS = 35_000; // 35s watchdog per tick to prevent false-positive aborts on network jitter
export const FUNDING_RATE_CAP = 0.0005; // +0.05% per 8h (+0.15% daily)
const RECONCILIATION_INTERVAL_TICKS = 300; // 300 ticks * 3s = 900s = 15 minutes
const CANDLE_BACKGROUND_REFRESH_MS = 10 * 60_000; // 10 minutes
const MAX_PERSISTED_NOTICES = 500;

export interface HybridLiveState {
  policyId: string;
  status: 'active' | 'risk_latched' | 'rebalance_pending';
  lastObservedAt: string;
  accountEquity: number;
  availableBalance: number;
  dayStartEquity: number;
  currentDayPnl: number;
  worstDayPnl: number;
  breakerLatched: boolean;
  positions: Record<string, { symbol: string; qty: number; entryPrice: number; markPrice: number; unrlPnl: number; slPrice: number; slPct?: number; maxReturnPct?: number; ratchetTier?: 'initial' | 'risk_reduction' | 'breakeven' | 'lock1' | 'lock2' | 'lock3' | 'lock'; entryTime?: number }>;
  btcGridLevels: Array<{ entryPrice: number; qty: number; tpPrice: number }>;
  lastRebalanceUtcDay?: string;
  daysSinceRebalance?: number;
  sameDaySlCooldown?: Record<string, string>;
  nativeStopsActive?: string[];
  momentumRetryAt?: number;
  lastReconciledAt?: string;
  candleCacheStatus?: { size: number; lastPrefetchAt?: number };
  dynamicUniverse?: {
    count: number;
    lastScannedAt?: string;
    topSymbols: string[];
  };
  eventShield?: {
    blacklistCount: number;
    criticalCloseCount: number;
    blacklistedSymbols: string[];
    lastScannedAt?: string;
  };
  dynamicCompounding?: {
    momentumAllocUsd: number;
    btcGridTicketUsd: number;
    dailyLossLimitUsd: number;
    targetMomentumPct: number;
    targetGridTicketPct: number;
  };
  volatilityGrid?: {
    atr14: number;
    atr14Pct: number;
    volMultiplier: number;
    gridStepPct: number;
    gridTpPct: number;
    crashGatePct: number;
    regime: string;
  };
  momentumRegime?: {
    mode: 'normal' | 'macro_defensive' | 'crash_freeze';
    btc1dReturnPct: number;
    btc14dReturnPct: number | null;
    maxSlots: number;
    targetAllocPct: number;
  };
  cashFlow?: CashFlowSummary;
}

interface SymbolFilterInfo {
  stepSize: number;
  tickSize: number;
  minQty: number;
  minNotional: number;
}

function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const text = step.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

function isProfitableLockedTier(tier?: string): boolean {
  return tier === 'lock1' || tier === 'lock2' || tier === 'lock3' || tier === 'lock';
}

function isProfitableRatchetTier(tier?: string): boolean {
  return tier === 'breakeven' || isProfitableLockedTier(tier);
}

export function floorPriceToTick(price: number, tickSize: number): number {
  if (!Number.isFinite(price) || price <= 0) return price;
  if (!Number.isFinite(tickSize) || tickSize <= 0) return price;
  const decimals = stepDecimals(tickSize);
  const floored = Math.floor(price / tickSize + 1e-9) * tickSize;
  return Number(floored.toFixed(decimals));
}

export function formatToTick(price: number, tickSize: number): string {
  const decimals = stepDecimals(tickSize);
  return floorPriceToTick(price, tickSize).toFixed(decimals);
}

function formatToStep(qty: number, stepSize: number): string {
  const decimals = stepDecimals(stepSize);
  const floored = stepSize > 0 ? Math.floor(qty / stepSize + 1e-9) * stepSize : qty;
  return floored.toFixed(decimals);
}

/**
 * Computes 14-day momentum return from an array of daily kline bars.
 * Each bar is [openTime, open, high, low, close, ...].
 * Accurately aligns target closed candle and the candle 14 days prior.
 */
export function compute14dReturnFromCandles(
  candles: Array<[number, string, string, string, string, ...unknown[]]>
): number | null {
  if (!candles || candles.length < 15) return null;
  const now = Date.now();
  const currentDayUtcMidnight = Math.floor(now / 86_400_000) * 86_400_000;
  const lastCandle = candles[candles.length - 1];

  let targetCandle: [number, string, string, string, string, ...unknown[]];
  if (lastCandle[0] >= currentDayUtcMidnight && candles.length >= 16) {
    // New day's open bar has formed; use yesterday's closed bar at index -2
    targetCandle = candles[candles.length - 2];
  } else {
    // Pre-fetched before midnight roll (e.g. at 23:55 UTC); use the latest bar
    targetCandle = lastCandle;
  }

  const targetTime = targetCandle[0];
  const expectedPastTime = targetTime - 14 * 86_400_000;

  // Find the reference bar 14 days prior to target bar
  let baseCandle = candles.find((c) => Math.abs(c[0] - expectedPastTime) < 3_600_000);
  if (!baseCandle && candles.length >= 15) {
    baseCandle = candles[0]; // fallback to oldest available bar
  }

  if (!baseCandle) return null;

  const targetClose = parseFloat(targetCandle[4]);
  const pastClose = parseFloat(baseCandle[4]);
  if (!Number.isFinite(targetClose) || !Number.isFinite(pastClose) || pastClose <= 0) return null;

  return (targetClose - pastClose) / pastClose;
}

/**
 * Computes 14-day Average True Range percentage (ATR14%) from daily candles.
 * Normalized as ATR / close so it can be compared across assets of different price levels.
 */
export function computeSymbolAtr14Pct(
  candles: Array<[number, string, string, string, string, ...unknown[]]>
): number {
  if (!candles || candles.length < 15) return 0.05;
  const trs: number[] = [];
  const startIdx = Math.max(1, candles.length - 14);
  for (let i = startIdx; i < candles.length; i++) {
    const high = parseFloat(candles[i][2]);
    const low = parseFloat(candles[i][3]);
    const prevClose = parseFloat(candles[i - 1][4]);
    if (Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(prevClose) && prevClose > 0) {
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trs.push(tr / prevClose);
    }
  }
  return trs.length > 0 ? trs.reduce((a, b) => a + b, 0) / trs.length : 0.05;
}

/**
 * RAM Cache for daily kline bars of universe symbols.
 * Enables zero-latency (< 50ms) momentum decisions at Day Roll.
 */
export class CandleRamCache {
  private cache = new Map<string, { fetchedAt: number; candles: Array<[number, string, string, string, string, ...unknown[]]> }>();
  private prefetching = false;
  private lastPrefetchAt = 0;
  private prefetch2355DoneDate = '';

  public getCandles(symbol: string): Array<[number, string, string, string, string, ...unknown[]]> | null {
    const entry = this.cache.get(symbol);
    return entry ? entry.candles : null;
  }

  public setCandles(symbol: string, candles: Array<[number, string, string, string, string, ...unknown[]]>): void {
    this.cache.set(symbol, { fetchedAt: Date.now(), candles });
  }

  public hasSufficientCandles(symbol: string): boolean {
    const entry = this.cache.get(symbol);
    return !!entry && entry.candles.length >= 15;
  }

  public size(): number {
    return this.cache.size;
  }

  public getLastPrefetchAt(): number {
    return this.lastPrefetchAt;
  }

  /**
   * Pre-fetch 16 1d candles for all symbols in parallel batches with rate-limit respect.
   */
  public async prefetchAll(symbols: readonly string[]): Promise<{ successCount: number; failCount: number }> {
    if (this.prefetching) return { successCount: 0, failCount: 0 };
    this.prefetching = true;
    let successCount = 0;
    let failCount = 0;
    const chunkSize = 5;

    try {
      for (let i = 0; i < symbols.length; i += chunkSize) {
        const chunk = symbols.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async (sym) => {
            try {
              const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&limit=16`, {
                signal: AbortSignal.timeout(6_000),
              });
              if (!res.ok) {
                console.warn(`[HybridLiveWorker] [CandleCache] fetch ${sym} failed: HTTP ${res.status}`);
                failCount++;
                return;
              }
              const data = (await res.json()) as Array<[number, string, string, string, string, ...unknown[]]>;
              if (!Array.isArray(data) || data.length < 15) {
                console.warn(`[HybridLiveWorker] [CandleCache] fetch ${sym} insufficient candles: ${Array.isArray(data) ? data.length : 'not an array'}`);
                failCount++;
                return;
              }
              this.setCandles(sym, data);
              successCount++;
            } catch (err) {
              console.warn(`[HybridLiveWorker] [CandleCache] fetch ${sym} error:`, err instanceof Error ? err.message : err);
              failCount++;
            }
          })
        );
        if (i + chunkSize < symbols.length) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      this.lastPrefetchAt = Date.now();
      console.log(`[HybridLiveWorker] [CandleCache] Prefetch complete: ${successCount}/${symbols.length} symbols cached in RAM (${failCount} failures).`);
    } finally {
      this.prefetching = false;
    }
    return { successCount, failCount };
  }

  /**
   * Checks background pre-fetch triggers:
   * - 23:55:00 UTC pre-roll window (pre-fetches daily candles before 00:00:00 UTC roll)
   * - Periodic 10-minute refresh loop
   */
  public async checkBackgroundPrefetch(symbols: readonly string[]): Promise<void> {
    const now = Date.now();
    const utcDate = new Date(now);
    const utcHours = utcDate.getUTCHours();
    const utcMinutes = utcDate.getUTCMinutes();
    const dateStr = utcDate.toISOString().slice(0, 10);

    // 1. Check for 23:55 UTC pre-roll prefetch window
    if (utcHours === 23 && utcMinutes >= 55 && utcMinutes <= 58) {
      if (this.prefetch2355DoneDate !== dateStr && !this.prefetching) {
        console.log(`[HybridLiveWorker] [CandleCache] Triggering 23:55 UTC pre-roll candle prefetch for ${dateStr}...`);
        this.prefetch2355DoneDate = dateStr;
        await this.prefetchAll(symbols);
        return;
      }
    }

    // 2. Periodic background refresh every 10 minutes to maintain fresh RAM buffer
    if (now - this.lastPrefetchAt >= CANDLE_BACKGROUND_REFRESH_MS && !this.prefetching) {
      void this.prefetchAll(symbols);
    }
  }
}

/** Fetches 16 daily Binance Futures kline bars for a symbol. */
export async function fetchCandles1d(
  symbol: string
): Promise<Array<[number, string, string, string, string, ...unknown[]]> | null> {
  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=16`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) {
      console.warn(`[HybridLiveWorker] fetchCandles1d ${symbol} failed: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as Array<[number, string, string, string, string, ...unknown[]]>;
    if (!Array.isArray(data) || data.length < 15) {
      console.warn(`[HybridLiveWorker] fetchCandles1d ${symbol} insufficient candles: ${Array.isArray(data) ? data.length : 'not an array'}`);
      return null;
    }
    return data;
  } catch (err) {
    console.warn(`[HybridLiveWorker] fetchCandles1d ${symbol} error:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** REST fallback when RAM cache is missing or cold. */
export async function fetch14dReturn(symbol: string): Promise<number | null> {
  const data = await fetchCandles1d(symbol);
  if (!data) return null;
  const ret = compute14dReturnFromCandles(data);
  if (ret === null) {
    console.warn(`[HybridLiveWorker] fetch14dReturn ${symbol} could not compute valid 14d return from candles.`);
    return null;
  }
  return ret;
}

export const MAX_MOMENTUM_ATR_PCT = 0.20; // Hyper-volatility ceiling (20% daily ATR: blocks extreme disasters like QUSDT 70% while capturing 14%-18% momentum runners)

export interface MomentumRegimeDecision {
  mode: 'normal' | 'macro_defensive' | 'crash_freeze';
  crashBlocked: boolean;
  maxSlots: number;
  allocPct: number;
}

/**
 * Resolves momentum portfolio sizing and slot ceiling from BTC 1d and 14d returns.
 * - BTC signal unavailable: Fail-safe freeze (0 new entries until signal recovers).
 * - BTC 1d/24h <= -3%: Crash Freeze (0 new entries).
 * - BTC 14d <= -10%: Macro Bear Defensive Mode (1 slot max at 25% equity, keeping 75% cash).
 * - Otherwise: Normal Mode (2 slots at 35% equity).
 */
export function resolveMomentumRegime(
  btc1dReturn: number,
  btc14dReturn: number | null,
  signalAvailable = true
): MomentumRegimeDecision {
  if (!signalAvailable || btc1dReturn <= BTC_CRASH_HEALTH_GATE_PCT) {
    return { mode: 'crash_freeze', crashBlocked: true, maxSlots: 0, allocPct: 0 };
  }
  if (btc14dReturn !== null && btc14dReturn <= BTC_MACRO_BEAR_GATE_PCT) {
    return {
      mode: 'macro_defensive',
      crashBlocked: false,
      maxSlots: 1,
      allocPct: DEFENSIVE_MOMENTUM_ALLOC_PCT,
    };
  }
  return {
    mode: 'normal',
    crashBlocked: false,
    maxSlots: 2,
    allocPct: MOMENTUM_ALLOC_PCT,
  };
}

/**
 * Fetches live 24h rolling percentage change (as decimal, e.g. -0.08 = -8%) for all Binance Futures symbols.
 */
export async function fetchAll24hChanges(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr', {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return map;
    const data = (await res.json()) as Array<{ symbol: string; priceChangePercent?: string }>;
    if (Array.isArray(data)) {
      for (const item of data) {
        const pct = parseFloat(item.priceChangePercent || '');
        if (item.symbol && Number.isFinite(pct)) {
          map.set(item.symbol, pct / 100);
        }
      }
    }
  } catch (err) {
    console.warn('[HybridLiveWorker] fetchAll24hChanges error:', err instanceof Error ? err.message : err);
  }
  return map;
}

/** Shared momentum + defensive safety evaluator used by both RAM cache hits and REST fallback. */
function evaluateMomentumCandidate(
  sym: string,
  candles: Array<[number, string, string, string, string, ...unknown[]]>,
  rolling24hRet?: number
): { symbol: string; score: number; rawReturn: number; atr14Pct: number } | null {
  const rawRet = compute14dReturnFromCandles(candles);
  if (rawRet === null || rawRet < 0.02) return null;

  // 1. Falling-Knife 24h / Intraday Guard: block active crashes (e.g. -25% 24h dump on stale 14d gain)
  if (rolling24hRet !== undefined && rolling24hRet <= FALLING_KNIFE_24H_FLOOR_PCT) {
    console.log(`[HybridLiveWorker] computeMomentumUniverse: Skipping ${sym} due to 24h dump (${(rolling24hRet * 100).toFixed(1)}% <= ${(FALLING_KNIFE_24H_FLOOR_PCT * 100).toFixed(1)}%).`);
    return null;
  }

  if (candles.length >= 16) {
    const lastBar = candles[candles.length - 1];
    const todayOpen = parseFloat(lastBar[1]);
    const todayClose = parseFloat(lastBar[4]);
    if (todayOpen > 0 && todayClose > 0 && todayOpen !== todayClose) {
      const intradayRet = (todayClose - todayOpen) / todayOpen;
      if (intradayRet <= FALLING_KNIFE_24H_FLOOR_PCT) {
        console.log(`[HybridLiveWorker] computeMomentumUniverse: Skipping ${sym} due to intraday dump (${(intradayRet * 100).toFixed(1)}% <= ${(FALLING_KNIFE_24H_FLOOR_PCT * 100).toFixed(1)}%).`);
        return null;
      }
      const expected14dTime = lastBar[0] - 14 * 86_400_000;
      const base14dBar =
        candles.find((c) => Math.abs(c[0] - expected14dTime) < 3_600_000) ?? candles[candles.length - 15];
      const baseClose = base14dBar ? parseFloat(base14dBar[4]) : 0;
      if (baseClose > 0 && (todayClose - baseClose) / baseClose <= 0) {
        console.log(`[HybridLiveWorker] computeMomentumUniverse: Skipping ${sym} (live 14d momentum flipped negative).`);
        return null;
      }
    }
  }

  // 2. Hyper-volatility filter: Cap ATR <= 20% to exclude pump-and-dump altcoins while capturing high-alpha runners
  const atr14Pct = computeSymbolAtr14Pct(candles);
  if (atr14Pct > MAX_MOMENTUM_ATR_PCT) {
    console.log(`[HybridLiveWorker] computeMomentumUniverse: Skipping ${sym} due to hyper-volatility ATR14 (${(atr14Pct * 100).toFixed(1)}% > ${(MAX_MOMENTUM_ATR_PCT * 100).toFixed(1)}%).`);
    return null;
  }

  return { symbol: sym, score: rawRet, rawReturn: rawRet, atr14Pct };
}

/**
 * Computes momentum score for universe symbols.
 * Reads instantly from RAM cache (< 50ms). Falls back to REST for missing symbols using identical filters.
 * Filters out hyper-volatile (>20% ATR14) and falling-knife dumping (<= -15% 24h/intraday) tokens,
 * and ranks by Raw 14d Return for Max Alpha ROI.
 */
export async function computeMomentumUniverse(
  candleCache?: CandleRamCache,
  universeSymbols?: readonly string[],
  changes24h?: Map<string, number>
): Promise<Array<{ symbol: string; score: number; rawReturn?: number; atr14Pct?: number }>> {
  const t0 = Date.now();
  const targetSymbols = (universeSymbols && universeSymbols.length > 0 ? universeSymbols : SOURCE_MOMENTUM_SYMBOLS).filter((s) => /^[A-Z0-9_]{2,40}$/.test(s));
  const results: Array<{ symbol: string; score: number; rawReturn?: number; atr14Pct?: number }> = [];
  const missingSymbols: string[] = [];

  for (const sym of targetSymbols) {
    const cachedCandles = candleCache?.getCandles(sym);
    if (cachedCandles && cachedCandles.length >= 15) {
      const evaluated = evaluateMomentumCandidate(sym, cachedCandles, changes24h?.get(sym));
      if (evaluated) results.push(evaluated);
    } else {
      missingSymbols.push(sym);
    }
  }

  // Fallback to REST for missing symbols if cache was incomplete (applies identical ATR/knife/14d filters)
  if (missingSymbols.length > 0) {
    console.warn(`[HybridLiveWorker] computeMomentumUniverse: ${missingSymbols.length} symbols missing in RAM cache, falling back to REST: ${missingSymbols.join(', ')}`);
    for (const sym of missingSymbols) {
      const candles = await fetchCandles1d(sym);
      if (candles) {
        candleCache?.setCandles(sym, candles);
        const evaluated = evaluateMomentumCandidate(sym, candles, changes24h?.get(sym));
        if (evaluated) results.push(evaluated);
      } else {
        console.warn(`[HybridLiveWorker] computeMomentumUniverse: REST fallback also failed for ${sym}.`);
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  const elapsed = Date.now() - t0;
  console.log(`[HybridLiveWorker] computeMomentumUniverse finished in ${elapsed}ms (${results.length} qualifying symbols, RAM hits: ${targetSymbols.length - missingSymbols.length}/${targetSymbols.length}).`);
  return results;
}

/**
 * Fetches current funding rate for all Binance futures contracts in a single call.
 */
export async function fetchAllFundingRates(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex', {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) {
      console.warn(`[HybridLiveWorker] fetchAllFundingRates failed: HTTP ${res.status}`);
      return map;
    }
    const data = (await res.json()) as Array<{ symbol: string; lastFundingRate: string }>;
    if (Array.isArray(data)) {
      for (const item of data) {
        const rate = parseFloat(item.lastFundingRate);
        if (Number.isFinite(rate)) {
          map.set(item.symbol, rate);
        }
      }
    }
  } catch (err) {
    console.warn('[HybridLiveWorker] fetchAllFundingRates error:', err instanceof Error ? err.message : err);
  }
  return map;
}

/**
 * Selects Top N momentum symbols with Funding Rate Guard filter and LLM Event Shield.
 * - Skips blacklisted symbols (delisting, exploit, regulatory freeze).
 * - Skips coins whose lastFundingRate > 0.0005 (+0.05%/8h = +0.15%/day) and picks the next candidate.
 */
export async function selectTopMomentumSymbols(
  ranked: Array<{ symbol: string; score: number }>,
  targetCount = 2,
  logPrefix = 'Rebalance',
  eventShield?: LLMEventShield,
  excludeSymbols?: Set<string>
): Promise<string[]> {
  if (ranked.length === 0) return [];

  const fundingRates = await fetchAllFundingRates();
  const selected: string[] = [];

  for (const candidate of ranked) {
    if (excludeSymbols?.has(candidate.symbol)) {
      console.log(`[HybridLiveWorker] ${logPrefix}: Symbol ${candidate.symbol} skipped (in exclude/cooldown list)`);
      continue;
    }

    // Phase 4: LLM Event Shield Check
    if (eventShield?.isBlacklisted(candidate.symbol)) {
      const entry = eventShield.getEntry(candidate.symbol);
      console.warn(
        `[HybridLiveWorker] ${logPrefix}: Symbol ${candidate.symbol} skipped by LLM Event Shield (${entry?.category}: ${entry?.reason})`
      );
      continue;
    }

    // Phase 3: Funding Rate Guard Check
    const fundingRate = fundingRates.get(candidate.symbol) ?? 0;
    if (fundingRate > FUNDING_RATE_CAP) {
      const pctStr = (fundingRate * 100).toFixed(2);
      console.log(`[HybridLiveWorker] ${logPrefix}: Symbol ${candidate.symbol} skipped due to high funding rate (+${pctStr}% > 0.05%)`);
      continue;
    }

    selected.push(candidate.symbol);
    if (selected.length >= targetCount) break;
  }

  return selected;
}

async function fetchBtcGridSignal(volGridController: VolatilityGridController): Promise<{
  ema10: number;
  oneDayReturn: number;
  btc14dReturn: number | null;
  crashGateTripped: boolean;
  signalAvailable: boolean;
  volParams: VolatilityGridParams;
}> {
  try {
    const [klinesRes, tickerRes] = await Promise.all([
      fetch('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1d&limit=20', {
        signal: AbortSignal.timeout(6_000),
      }),
      fetch('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT', {
        signal: AbortSignal.timeout(6_000),
      }),
    ]);
    if (!klinesRes.ok) {
      const volParams = volGridController.getLastParams();
      return { ema10: 0, oneDayReturn: 0, btc14dReturn: null, crashGateTripped: false, signalAvailable: false, volParams };
    }
    const data = (await klinesRes.json()) as Array<[number, string, string, string, string, ...unknown[]]>;
    if (data.length < 11) {
      const volParams = volGridController.getLastParams();
      return { ema10: 0, oneDayReturn: 0, btc14dReturn: null, crashGateTripped: false, signalAvailable: false, volParams };
    }
    const lastBar = data[data.length - 1];
    const todayOpen = parseFloat(lastBar[1] as string);
    const todayCurrent = parseFloat(lastBar[4] as string);
    const todayReturn = todayOpen > 0 ? (todayCurrent - todayOpen) / todayOpen : 0;

    let btc14dReturn: number | null = null;
    const expected14dTime = lastBar[0] - 14 * 86_400_000;
    const base14dBar = data.find((c) => Math.abs(c[0] - expected14dTime) < 3_600_000) ?? (data.length >= 15 ? data[data.length - 15] : undefined);
    if (base14dBar) {
      const baseClose = parseFloat(base14dBar[4] as string);
      if (Number.isFinite(baseClose) && baseClose > 0 && todayCurrent > 0) {
        btc14dReturn = (todayCurrent - baseClose) / baseClose;
      }
    }

    let rolling24hReturn = todayReturn;
    if (tickerRes.ok) {
      try {
        const tickerData = (await tickerRes.json()) as { priceChangePercent?: string };
        if (tickerData?.priceChangePercent) {
          rolling24hReturn = parseFloat(tickerData.priceChangePercent) / 100;
        }
      } catch {
        rolling24hReturn = todayReturn;
      }
    }

    // Dynamic 24h & Intraday Crash Protection:
    // Uses the worst of rolling 24-hour return (from Binance 24h ticker, continuous rolling window)
    // or intraday return (from today's 00:00 UTC open).
    // Eliminates artificial calendar day freezing while detecting both ongoing dumps and sudden intraday crashes.
    const oneDayReturn = Math.min(todayReturn, rolling24hReturn);
    const closes = data.slice(-11, -1).map((k) => parseFloat(k[4] as string));
    const ema10 = closes.reduce((sum, v) => sum + v, 0) / closes.length;

    const candleData: CandleData[] = data.map((k) => ({
      high: parseFloat(k[2] as string),
      low: parseFloat(k[3] as string),
      close: parseFloat(k[4] as string),
    }));
    const volParams = volGridController.computeGridParams(candleData);
    const crashGateTripped = oneDayReturn < -volParams.crashGatePct;
    return { ema10, oneDayReturn, btc14dReturn, crashGateTripped, signalAvailable: true, volParams };
  } catch {
    const volParams = volGridController.getLastParams();
    return { ema10: 0, oneDayReturn: 0, btc14dReturn: null, crashGateTripped: false, signalAvailable: false, volParams };
  }
}

export class HybridLiveWorker {
  private broker: LiveBroker;
  private running = false;
  private stateDir: string;
  private dayStartEquity = 100.0;
  private worstDayPnl = 0;
  private currentDay = '';
  private restoredObservedDay = '';
  private breakerLatched = false;
  private lastMomentumRegime: HybridLiveState['momentumRegime'];
  private sentNotices = new Set<string>();
  private noticesLoaded = false;
  private lastState: HybridLiveState | null = null;
  private stopTelegramListener: (() => void) | null = null;
  private exchangeFilters: Record<string, SymbolFilterInfo> = {};
  private rawExchangeSymbols: ExchangeContractStatus[] = [];
  private configuredLeverageSymbols = new Set<string>();
  private eventShieldScanning = false;
  private tickInProgress = false;
  private retryingMomentum = false;
  private lastBtcMarkPrice = 0;
  private nativeStops = new Set<string>();
  private stopRetryAt = new Map<string, number>();
  private daysSinceRebalance = 0;
  private lastRebalanceUtcDay = '';
  private momentumRetryAt = 0;
  private lastBtcCrashAlertTs = 0;
  private btcGridLevels: Array<{ entryPrice: number; qty: number; tpPrice: number }> = [];
  private tickCounter = 0;
  private lastReconciledAt = '';
  public candleCache = new CandleRamCache();
  public dynamicUniverseScanner = new DynamicUniverseScanner();
  public eventShield = new LLMEventShield();
  public compoundingManager = new DynamicCompoundingManager();
  public volatilityGridController = new VolatilityGridController();
  public cashFlowManager = new CashFlowManager();
  public ratchetState = new Map<
    string,
    {
      entryPrice: number;
      currentSl: number;
      initialSlPct: number;
      maxRet: number;
      tier: 'initial' | 'risk_reduction' | 'breakeven' | 'lock1' | 'lock2' | 'lock3' | 'lock';
      entryTime: number;
    }
  >();
  public sameDaySlCooldown = new Map<string, string>(); // symbol -> UTC day e.g. "2026-10-29"
  public activeTrackedPositions = new Map<
    string,
    {
      qty: number;
      entryPrice: number;
      slPrice: number;
      ratchetTier?: 'initial' | 'risk_reduction' | 'breakeven' | 'lock1' | 'lock2' | 'lock3' | 'lock';
    }
  >();

  constructor() {
    this.broker = createDefaultLiveBroker({
      requestTimeoutMs: 8_000,
      retryReads: true,
      executionOwner: process.env.PORTFOLIO_EXECUTION_OWNER?.trim() || HYBRID_POLICY_ID,
    });
    this.stateDir = path.resolve(__dirname, '../../data/portfolio-live', HYBRID_POLICY_ID);
  }

  /**
   * v1.0.1: Differentiated Cooldown Check.
   * - Losing exits (initial SL -12% or v1.0.1 Pruning -5%) stay in full Same-Day UTC cooldown (until 00:00 UTC).
   * - Profitable ratchet exits (breakeven, lock1, lock2, lock3) stay in 2-hour cooldown (PROFIT_LOCK_COOLDOWN_MS).
   */
  public isSymbolInCooldown(sym: string, nowMs = Date.now()): boolean {
    const cd = this.sameDaySlCooldown.get(sym);
    if (!cd) return false;
    if (cd.includes('T')) {
      const expireMs = new Date(cd).getTime();
      if (Number.isFinite(expireMs) && nowMs < expireMs) {
        return true;
      }
      this.sameDaySlCooldown.delete(sym);
      return false;
    }
    const todayUtc = this.getUtcDay();
    if (cd === todayUtc) {
      return true;
    }
    this.sameDaySlCooldown.delete(sym);
    return false;
  }

  public async start(): Promise<void> {
    console.log(`[HybridLiveWorker] Starting Production Release ${OFFICIAL_RELEASE_VERSION} Live Worker (${HYBRID_POLICY_ID})...`);
    await fs.mkdir(this.stateDir, { recursive: true });

    this.running = true;
    this.setupSignalHandlers();

    await this.loadExchangeFilters();
    await this.restoreDayAnchor();

    // Initialize Event Shield
    await this.eventShield.init();

    // Initialize Dynamic Universe Scanner (Top 30 Binance Futures > $50M/d)
    await this.dynamicUniverseScanner.refreshUniverse(true);
    const activeUniverse = this.dynamicUniverseScanner.getUniverse();
    console.log(`[HybridLiveWorker] Active dynamic universe loaded: ${activeUniverse.length} symbols.`);

    // Warm up candle RAM cache for zero-latency momentum calculations
    console.log(`[HybridLiveWorker] Warming up candle RAM cache for ${activeUniverse.length} dynamic universe symbols...`);
    await this.candleCache.prefetchAll(activeUniverse);

    // Initialize Cash Flow Manager
    await this.cashFlowManager.load();

    // Initial cross-reconciliation with exchange ground truth
    await this.reconcileState();

    // Seed activeTrackedPositions with currently open positions (preserving restored ratchet SL/tier)
    try {
      const initialPositions = await this.broker.getPositions();
      for (const p of initialPositions) {
        if (p.symbol === 'BTCUSDT') continue;
        const q = parseFloat(p.positionAmt);
        if (Math.abs(q) > 0) {
          const ent = parseFloat(p.entryPrice);
          const rState = this.ratchetState.get(p.symbol);
          const tickSize = this.exchangeFilters[p.symbol]?.tickSize ?? 0;
          const fallbackSl = q > 0 ? floorPriceToTick(ent * (1.0 - MOMENTUM_SL_PCT), tickSize) : ent * (1.0 + MOMENTUM_SL_PCT);
          this.activeTrackedPositions.set(p.symbol, {
            qty: Math.abs(q),
            entryPrice: ent,
            slPrice: rState?.currentSl ?? fallbackSl,
            ratchetTier: rState?.tier || 'initial',
          });
        }
      }
    } catch (err) {
      console.warn('[HybridLiveWorker] Could not pre-seed activeTrackedPositions:', err);
    }

    // Run initial automated Event Shield scan (Binance contract status + public security RSS feeds)
    await this.runEventShieldScan();

    // Start interactive Telegram listener only if explicitly enabled (embedded mode)
    if (process.env.HYBRID_EMBEDDED_TELEGRAM_LISTENER === 'true') {
      console.log('[HybridLiveWorker] Starting embedded Telegram listener...');
      this.stopTelegramListener = startHybridTelegramCommandListener(() => this.lastState);
    } else {
      console.log('[HybridLiveWorker] Embedded Telegram listener disabled (standalone crypto-telegram-bot handles polling).');
    }

    // Initial tick
    await this.tick();

    // Run continuous loop with non-overlapping 35s watchdog per tick to prevent socket hangs & concurrency races
    const loop = async () => {
      while (this.running) {
        if (this.tickInProgress) {
          await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
          continue;
        }
        this.tickInProgress = true;
        let tickPromise: Promise<void> | null = null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          tickPromise = this.tick();
          await Promise.race([
            tickPromise,
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`Tick watchdog timeout (${WATCHDOG_TIMEOUT_MS / 1000}s)`)),
                WATCHDOG_TIMEOUT_MS
              );
            }),
          ]);
        } catch (error) {
          console.error('[HybridLiveWorker] Tick error:', error instanceof Error ? error.message : error);
        } finally {
          if (timer) clearTimeout(timer);
          if (tickPromise) {
            void tickPromise.finally(() => {
              this.tickInProgress = false;
            });
          } else {
            this.tickInProgress = false;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
      }
    };

    void loop();
  }

  public stop(): void {
    console.log('[HybridLiveWorker] Gracefully stopping worker...');
    this.running = false;
    this.stopTelegramListener?.();
    process.exit(0);
  }

  private setupSignalHandlers(): void {
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
    process.on('uncaughtException', (err) => {
      console.error('[HybridLiveWorker] Uncaught exception:', err);
      process.exit(1);
    });
  }

  private getUtcDay(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private async loadExchangeFilters(): Promise<void> {
    try {
      const info: LiveExchangeInfo = await this.broker.getExchangeInfo();
      const tradableCrypto = new Set<string>();
      const rawContracts: ExchangeContractStatus[] = [];
      for (const s of (info.symbols as any[])) {
        rawContracts.push({
          symbol: s.symbol,
          status: s.status,
          contractType: s.contractType,
          quoteAsset: s.quoteAsset,
          deliveryDate: typeof s.deliveryDate === 'number' ? s.deliveryDate : undefined,
        });
        // Strict crypto perpetual contract guard: Exclude commodities (oil, gold), equities, pre-market, quarterly delivery
        if (s.status !== 'TRADING') continue;
        if (s.contractType !== 'PERPETUAL') continue;
        if (s.underlyingType && s.underlyingType !== 'COIN') continue;
        if (s.quoteAsset && s.quoteAsset !== 'USDT') continue;

        const lot = s.filters.find((f: Record<string, unknown>) => f.filterType === 'LOT_SIZE') as Record<string, string> | undefined;
        const price = s.filters.find((f: Record<string, unknown>) => f.filterType === 'PRICE_FILTER') as Record<string, string> | undefined;
        const notional = s.filters.find((f: Record<string, unknown>) => f.filterType === 'MIN_NOTIONAL') as Record<string, string> | undefined;
        if (lot && price) {
          tradableCrypto.add(s.symbol);
          this.exchangeFilters[s.symbol] = {
            stepSize: parseFloat(lot.stepSize || '1'),
            tickSize: parseFloat(price.tickSize || '0.0001'),
            minQty: parseFloat(lot.minQty || '1'),
            minNotional: parseFloat(notional?.notional || '5.0'),
          };
        }
      }
      this.rawExchangeSymbols = rawContracts;
      this.dynamicUniverseScanner.setAllowedSymbols(tradableCrypto);
      console.log(`[HybridLiveWorker] Loaded exchange filters for ${Object.keys(this.exchangeFilters).length} tradable crypto perpetual symbols.`);
    } catch (err) {
      console.warn('[HybridLiveWorker] Could not load exchange filters on start:', err);
    }
  }

  public async runEventShieldScan(): Promise<void> {
    if (this.eventShieldScanning) return;
    this.eventShieldScanning = true;
    try {
      const watched = new Set<string>([
        ...this.dynamicUniverseScanner.getUniverse(),
        ...this.activeTrackedPositions.keys(),
      ]);
      const tradableSet = new Set(Object.keys(this.exchangeFilters));
      const contractAlerts = await this.eventShield.scanExchangeStatuses(this.rawExchangeSymbols, watched);
      const rssAlerts = await this.eventShield.scanRssFeeds(tradableSet.size > 0 ? tradableSet : undefined);
      for (const alert of [...contractAlerts, ...rssAlerts]) {
        if (watched.has(alert.symbol) || alert.severity === 'CRITICAL_CLOSE') {
          await sendHybridTelegram(
            `🛡️ [EVENT SHIELD TỰ ĐỘNG] ĐÃ ĐƯA ${alert.symbol} VÀO BLACKLIST!\n` +
            `• Mức độ: ${alert.severity}\n` +
            `• Phân loại: ${alert.category}\n` +
            `• Lý do: ${alert.reason}`
          );
        }
      }
    } catch (err) {
      console.warn('[HybridLiveWorker] [EventShield] Auto scan error:', err instanceof Error ? err.message : err);
    } finally {
      this.eventShieldScanning = false;
    }
  }

  /** Keep the 12 USDT day anchor, rebalance state, and grid state across restarts. */
  private async restoreDayAnchor(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(this.stateDir, 'worker-status.json'), 'utf8')) as HybridLiveState;
      this.lastState = raw;
      const observed = Date.parse(raw.lastObservedAt);
      if (Array.isArray(raw.btcGridLevels)) {
        this.btcGridLevels = raw.btcGridLevels;
      }
      if (typeof raw.lastRebalanceUtcDay === 'string') {
        this.lastRebalanceUtcDay = raw.lastRebalanceUtcDay;
      }
      if (typeof raw.daysSinceRebalance === 'number') {
        this.daysSinceRebalance = raw.daysSinceRebalance;
      }
      if (raw.momentumRegime) {
        this.lastMomentumRegime = raw.momentumRegime;
      }
      if (raw.sameDaySlCooldown && typeof raw.sameDaySlCooldown === 'object') {
        for (const [sym, date] of Object.entries(raw.sameDaySlCooldown)) {
          if (typeof date === 'string') {
            this.sameDaySlCooldown.set(sym, date);
            if (!this.isSymbolInCooldown(sym)) {
              this.sameDaySlCooldown.delete(sym);
            }
          }
        }
      }
      if (raw.positions && typeof raw.positions === 'object') {
        for (const [sym, pos] of Object.entries(raw.positions)) {
          if (pos && typeof pos === 'object' && pos.entryPrice) {
            this.ratchetState.set(sym, {
              entryPrice: pos.entryPrice,
              currentSl: pos.slPrice || pos.entryPrice * 0.88,
              initialSlPct: pos.slPct || 0.12,
              maxRet: (pos.maxReturnPct || 0) / 100.0,
              tier: pos.ratchetTier || 'initial',
              entryTime: pos.entryTime || Date.now(),
            });
          }
        }
      }
      // On boot/restart, allow an immediate momentum retry check if a slot is vacant
      this.momentumRetryAt = 0;
      if (!Number.isFinite(observed) || !Number.isFinite(raw.dayStartEquity) || raw.dayStartEquity <= 0) return;
      const observedDay = new Date(observed).toISOString().slice(0, 10);
      this.restoredObservedDay = observedDay;
      if (observedDay !== this.getUtcDay()) return;
      this.currentDay = observedDay;
      this.dayStartEquity = raw.dayStartEquity;
      this.worstDayPnl = Math.min(0, Number.isFinite(raw.worstDayPnl) ? raw.worstDayPnl : 0);
      this.breakerLatched = raw.breakerLatched === true;
      console.log(`[HybridLiveWorker] Restored day anchor ${raw.dayStartEquity} for ${observedDay}, daysSinceRebalance: ${this.daysSinceRebalance}`);
    } catch {
      // First boot has no status file.
    }
  }

  private async submitVenueStopOrder(symbol: string, qty: number, slPrice: number): Promise<string | null> {
    const filter = this.exchangeFilters[symbol];
    if (!filter) return null;
    const stopPriceStr = formatToTick(slPrice, filter.tickSize);
    const qtyStr = formatToStep(Math.abs(qty), filter.stepSize);
    const clientOrderId = `sl_${symbol.toLowerCase()}_${Date.now()}`.slice(0, 36);
    await this.broker.submitStopMarketOrder({
      symbol,
      side: qty > 0 ? 'SELL' : 'BUY',
      stopPrice: stopPriceStr,
      quantity: qtyStr,
      clientOrderId,
      positionSide: 'BOTH',
      reduceOnly: true,
    });
    this.nativeStops.add(symbol);
    this.stopRetryAt.delete(symbol);
    console.log(`[HybridLiveWorker] Native venue STOP_MARKET placed for ${symbol}: SL=${stopPriceStr}, Qty=${qtyStr}`);
    return clientOrderId;
  }

  private async syncNativeStopLoss(symbol: string, qty: number, slPrice: number): Promise<boolean> {
    if (this.nativeStops.has(symbol)) return true;
    const retryAt = this.stopRetryAt.get(symbol) ?? 0;
    if (retryAt > Date.now()) return false;
    try {
      const filter = this.exchangeFilters[symbol];
      if (!filter) return false;
      const algoOrders = await this.broker.getOpenAlgoOrders(symbol);
      const existingStop = algoOrders.find(
        (order) =>
          (order.orderType === 'STOP_MARKET' || order.type === 'STOP_MARKET') &&
          (order.algoStatus === 'NEW' || !order.algoStatus)
      );
      if (existingStop) {
        this.nativeStops.add(symbol);
        return true;
      }
      return Boolean(await this.submitVenueStopOrder(symbol, qty, slPrice));
    } catch (err) {
      this.stopRetryAt.set(symbol, Date.now() + 60_000);
      console.warn(`[HybridLiveWorker] Could not place native STOP_MARKET for ${symbol}:`, err instanceof Error ? err.message : err);
      return false;
    }
  }

  /** Places the replacement STOP_MARKET before cancelling older stop orders so no naked window occurs on failure. */
  private async replaceNativeStopLoss(symbol: string, qty: number, newSlPrice: number): Promise<boolean> {
    try {
      const newClientOrderId = await this.submitVenueStopOrder(symbol, qty, newSlPrice);
      if (!newClientOrderId) return false;
      await this.cancelSymbolStops(symbol, newClientOrderId);
      this.nativeStops.add(symbol);
      return true;
    } catch (err) {
      console.warn(
        `[HybridLiveWorker] Could not replace native STOP_MARKET for ${symbol} (preserving previous venue stop):`,
        err instanceof Error ? err.message : err
      );
      return false;
    }
  }

  private async cancelSymbolStops(symbol: string, keepClientAlgoId?: string): Promise<void> {
    if (!keepClientAlgoId) {
      this.nativeStops.delete(symbol);
    }
    try {
      const algoOrders = await this.broker.getOpenAlgoOrders(symbol);
      for (const order of algoOrders) {
        const clientAlgoId = String(order.clientAlgoId ?? order.clientOrderId ?? order.algoId ?? '');
        if (!clientAlgoId || clientAlgoId === keepClientAlgoId) continue;
        if (order.orderType === 'STOP_MARKET' || order.type === 'STOP_MARKET') {
          await this.broker.cancelAlgoOrder(symbol, clientAlgoId);
          console.log(`[HybridLiveWorker] Cancelled open stop order for ${symbol}: ${clientAlgoId}`);
        }
      }
    } catch (err) {
      console.warn(`[HybridLiveWorker] Failed to cancel open stop orders for ${symbol}:`, err);
    }
  }

  /**
   * Periodic cross-reconciliation (every 15m / 300 ticks) against exchange ground truth.
   * Compares positions and open algo orders with worker-status.json.
   * If discrepancies found (e.g. liquidated/manually closed or missing SL), reconciles immediately.
   */
  public async reconcileState(): Promise<void> {
    try {
      const [positions, account] = await Promise.all([
        this.broker.getPositions(),
        this.broker.getAccount(),
      ]);

      const livePositions = positions.filter((p) => Math.abs(parseFloat(p.positionAmt)) > 0);
      const liveMap = new Map<string, LivePosition>();
      for (const p of livePositions) {
        liveMap.set(p.symbol, p);
      }

      let discrepancyFound = false;

      // 1. Check existing state file on disk
      let diskState: HybridLiveState | null = null;
      try {
        diskState = JSON.parse(await fs.readFile(path.join(this.stateDir, 'worker-status.json'), 'utf8')) as HybridLiveState;
      } catch {
        // No status file yet
      }

      // Check if positions in state are missing or changed on exchange
      if (diskState && diskState.positions) {
        for (const [sym, statePos] of Object.entries(diskState.positions)) {
          const live = liveMap.get(sym);
          if (!live) {
            console.warn(`[HybridLiveWorker] [CrossReconciliation] Discrepancy detected: ${sym} recorded in state (qty=${statePos.qty}) but NOT active on Binance (closed or liquidated). Purging from state.`);
            delete diskState.positions[sym];
            this.nativeStops.delete(sym);
            const rState = this.ratchetState.get(sym);
            const tier = rState?.tier || 'initial';
            this.ratchetState.delete(sym);
            const todayUtc = this.getUtcDay();
            const isProfitableTier = tier === 'breakeven' || tier === 'lock' || tier === 'lock1' || tier === 'lock2' || tier === 'lock3';
            if (isProfitableTier) {
              const expireIso = new Date(Date.now() + PROFIT_LOCK_COOLDOWN_MS).toISOString();
              this.sameDaySlCooldown.set(sym, expireIso);
              console.log(`[HybridLiveWorker] [CrossReconciliation] Added ${sym} to Profitable Ratchet Cooldown (${PROFIT_LOCK_COOLDOWN_MS / 3_600_000}h until ${expireIso}).`);
            } else {
              this.sameDaySlCooldown.set(sym, todayUtc);
              console.log(`[HybridLiveWorker] [CrossReconciliation] Added ${sym} to Same-Day SL Cooldown for ${todayUtc}.`);
            }
            discrepancyFound = true;

            const noticeText = formatHybridPositionClosedNotice({
              symbol: sym,
              qty: statePos.qty,
              entryPrice: statePos.entryPrice,
              exitPrice: statePos.slPrice,
              pnl: (statePos.slPrice - statePos.entryPrice) * statePos.qty,
              reason: 'STOP_LOSS',
            });
            void sendHybridTelegram(noticeText);
          } else {
            const liveQty = parseFloat(live.positionAmt);
            if (Math.abs(liveQty - statePos.qty) > 1e-6) {
              console.warn(`[HybridLiveWorker] [CrossReconciliation] Discrepancy detected: ${sym} qty mismatch: state=${statePos.qty}, venue=${liveQty}. Updating state.`);
              statePos.qty = liveQty;
              statePos.entryPrice = parseFloat(live.entryPrice);
              discrepancyFound = true;
            }
          }
        }
      }

      // Check for live positions on Binance not recorded in state
      if (diskState) {
        if (!diskState.positions) diskState.positions = {};
        for (const p of livePositions) {
          if (p.symbol !== 'BTCUSDT' && !diskState.positions[p.symbol]) {
            console.warn(`[HybridLiveWorker] [CrossReconciliation] Discrepancy detected: Unrecorded live position on Binance: ${p.symbol} (qty=${p.positionAmt}). Adding to state.`);
            const qty = parseFloat(p.positionAmt);
            const entry = parseFloat(p.entryPrice);
            const mark = parseFloat(p.markPrice || p.entryPrice);
            diskState.positions[p.symbol] = {
              symbol: p.symbol,
              qty,
              entryPrice: entry,
              markPrice: mark,
              unrlPnl: (mark - entry) * qty,
              slPrice: qty > 0 ? entry * (1.0 - MOMENTUM_SL_PCT) : entry * (1.0 + MOMENTUM_SL_PCT),
            };
            discrepancyFound = true;
          }
        }
      }

      // Reconcile stale BTC grid levels when no live BTCUSDT position exists on exchange
      if (this.btcGridLevels.length > 0 && !liveMap.has('BTCUSDT')) {
        console.warn('[HybridLiveWorker] [CrossReconciliation] Clearing stale btcGridLevels (no live BTCUSDT position on Binance).');
        this.btcGridLevels = [];
        if (diskState) {
          diskState.btcGridLevels = [];
        }
        discrepancyFound = true;
      }

      // 2. Open Algo Orders cross-reconciliation
      for (const p of livePositions) {
        if (p.symbol === 'BTCUSDT' && this.btcGridLevels.length === 0) continue;
        const qty = parseFloat(p.positionAmt);
        if (qty <= 0) continue;

        try {
          const algoOrders = await this.broker.getOpenAlgoOrders(p.symbol);
          const activeStop = algoOrders.find(
            (o) =>
              (o.orderType === 'STOP_MARKET' || o.type === 'STOP_MARKET') &&
              (o.algoStatus === 'NEW' || !o.algoStatus)
          );

          if (activeStop) {
            this.nativeStops.add(p.symbol);
          } else {
            console.warn(`[HybridLiveWorker] [CrossReconciliation] Active position ${p.symbol} is MISSING exchange STOP_MARKET order! Re-placing immediately...`);
            this.nativeStops.delete(p.symbol);
            this.stopRetryAt.delete(p.symbol);
            const tickSize = this.exchangeFilters[p.symbol]?.tickSize ?? 0;
            const slPrice = this.ratchetState.get(p.symbol)?.currentSl ?? floorPriceToTick(parseFloat(p.entryPrice) * (1.0 - MOMENTUM_SL_PCT), tickSize);
            const placed = await this.syncNativeStopLoss(p.symbol, qty, slPrice);
            if (placed) {
              console.log(`[HybridLiveWorker] [CrossReconciliation] Successfully placed replacement STOP_MARKET for ${p.symbol}.`);
            }
            discrepancyFound = true;
          }
        } catch (err) {
          console.warn(`[HybridLiveWorker] [CrossReconciliation] Could not verify algo orders for ${p.symbol}:`, err instanceof Error ? err.message : err);
        }
      }

      // 3. Clean up orphan stops for symbols no longer held
      for (const sym of this.nativeStops) {
        if (!liveMap.has(sym)) {
          console.log(`[HybridLiveWorker] [CrossReconciliation] Cleaning up orphan stop orders for closed symbol: ${sym}`);
          await this.cancelSymbolStops(sym);
          this.nativeStops.delete(sym);
          if (sym !== 'BTCUSDT') {
            const rState = this.ratchetState.get(sym);
            const tier = rState?.tier || 'initial';
            const isProfitableTier = tier === 'breakeven' || tier === 'lock' || tier === 'lock1' || tier === 'lock2' || tier === 'lock3';
            if (isProfitableTier) {
              const expireIso = new Date(Date.now() + PROFIT_LOCK_COOLDOWN_MS).toISOString();
              this.sameDaySlCooldown.set(sym, expireIso);
              console.log(`[HybridLiveWorker] [CrossReconciliation] Added ${sym} to Profitable Ratchet Cooldown (2h until ${expireIso}).`);
            } else {
              const todayUtc = this.getUtcDay();
              this.sameDaySlCooldown.set(sym, todayUtc);
              console.log(`[HybridLiveWorker] [CrossReconciliation] Added ${sym} to Same-Day SL Cooldown for ${todayUtc}.`);
            }
          }
          discrepancyFound = true;
        }
      }

      for (const sym of this.ratchetState.keys()) {
        if (!liveMap.has(sym)) {
          this.ratchetState.delete(sym);
        }
      }

      this.lastReconciledAt = new Date().toISOString();

      if (discrepancyFound && diskState) {
        diskState.lastObservedAt = new Date().toISOString();
        diskState.accountEquity = parseFloat(account.totalMarginBalance || account.totalWalletBalance || '0');
        diskState.availableBalance = parseFloat(account.availableBalance || '0');
        diskState.lastReconciledAt = this.lastReconciledAt;
        await atomicWriteFile(path.join(this.stateDir, 'worker-status.json'), JSON.stringify(diskState, null, 2));
        this.lastState = diskState;
        console.log('[HybridLiveWorker] [CrossReconciliation] State file updated with reconciled data.');
      }

      console.log(`[HybridLiveWorker] [CrossReconciliation] Audit completed at tick ${this.tickCounter}: ${livePositions.length} live positions, ${this.nativeStops.size} active stop orders verified. Discrepancies resolved: ${discrepancyFound}`);

      // 4. External Cash Flow Reconciliation (Automatic Deposit/Withdrawal Isolation)
      try {
        const { newDeposits, newWithdrawals } = await this.cashFlowManager.syncFromBroker(this.broker);
        const liveEquity = parseFloat(account.totalMarginBalance || account.totalWalletBalance || '0') || this.dayStartEquity;
        const todayUtc = new Date().toISOString().slice(0, 10);

        for (const dep of newDeposits) {
          if (dep.dateUtc === todayUtc) {
            this.dayStartEquity += dep.amount;
            console.log(`[HybridLiveWorker] [CashFlow] Re-anchored dayStartEquity += ${dep.amount} to ${this.dayStartEquity.toFixed(2)} for today's deposit.`);
          }
          const summary = this.cashFlowManager.getSummary(liveEquity);
          await sendHybridTelegram(formatHybridCashFlowNotice({
            type: 'DEPOSIT',
            amount: dep.amount,
            tranId: dep.tranId,
            cumulativeDeposits: summary.cumulativeDeposits,
            strategyNetPnl: summary.strategyNetPnl,
            strategyRoiPct: summary.strategyRoiPct,
            accountEquity: liveEquity,
          }));
        }

        for (const w of newWithdrawals) {
          if (w.dateUtc === todayUtc) {
            this.dayStartEquity = Math.max(0, this.dayStartEquity - w.amount);
            console.log(`[HybridLiveWorker] [CashFlow] Re-anchored dayStartEquity -= ${w.amount} to ${this.dayStartEquity.toFixed(2)} for today's withdrawal.`);
          }
          const summary = this.cashFlowManager.getSummary(liveEquity);
          await sendHybridTelegram(formatHybridCashFlowNotice({
            type: 'WITHDRAWAL',
            amount: w.amount,
            tranId: w.tranId,
            cumulativeDeposits: summary.cumulativeDeposits,
            strategyNetPnl: summary.strategyNetPnl,
            strategyRoiPct: summary.strategyRoiPct,
            accountEquity: liveEquity,
          }));
        }
      } catch (cfErr) {
        console.warn('[HybridLiveWorker] [CashFlow] Failed to sync cash flows during reconciliation:', cfErr);
      }
    } catch (err) {
      console.error('[HybridLiveWorker] [CrossReconciliation] Error during reconciliation:', err instanceof Error ? err.message : err);
    }
  }

  private async ensureSafeLeverage(symbol: string): Promise<void> {
    if (this.configuredLeverageSymbols.has(symbol)) return;
    if (typeof this.broker.setLeverage !== 'function') {
      this.configuredLeverageSymbols.add(symbol);
      return;
    }
    try {
      const targetLeverage = Math.max(1, Math.min(SAFE_FUTURES_LEVERAGE, getMainnetMaxLeverage()));
      await this.broker.setLeverage(symbol, targetLeverage);
      this.configuredLeverageSymbols.add(symbol);
    } catch (err) {
      console.warn(`[HybridLiveWorker] Could not enforce leverage for ${symbol}:`, err instanceof Error ? err.message : err);
    }
  }

  private computeActiveNotional(positions: LivePosition[]): number {
    return positions.reduce((sum, p) => {
      const qty = Math.abs(parseFloat(p.positionAmt));
      const px = parseFloat(p.markPrice || p.entryPrice || '0');
      return qty > 0 && px > 0 ? sum + qty * px : sum;
    }, 0);
  }

  private async openMomentumPosition(
    sym: string,
    accountEquity: number,
    allocPct: number,
    clientPrefix: 'reb_open' | 'reb_retry',
    logPrefix: 'Rebalance' | 'Momentum retry',
    exposureCtx?: { availableBalance: number; activeNotionalUsd: number }
  ): Promise<{ symbol: string; qty: number; entryPrice: number } | null> {
    if (!/^[A-Z0-9_]{2,40}$/.test(sym)) {
      console.warn(`[HybridLiveWorker] ${logPrefix}: Skipping ${sym} (Invalid symbol format).`);
      return null;
    }
    try {
      const filter = this.exchangeFilters[sym];
      if (!filter) return null;
      const markPrices = await this.broker.getMarkPrices(sym);
      const mark = parseFloat(markPrices[0]?.markPrice || '0');
      if (mark <= 0) return null;

      const slPct = MOMENTUM_SL_PCT;
      const rawAllocUsd = this.compoundingManager.computeMomentumAlloc(accountEquity, filter.minNotional, allocPct);
      let allocUsd = rawAllocUsd;
      const targetLeverage = Math.max(1, Math.min(SAFE_FUTURES_LEVERAGE, getMainnetMaxLeverage()));

      if (exposureCtx) {
        const maxExposureUsd = getEffectiveMaxExposureUsd(accountEquity);
        const remainingExposureUsd = Math.max(0, maxExposureUsd - exposureCtx.activeNotionalUsd);
        if (remainingExposureUsd < filter.minNotional) {
          console.warn(
            `[HybridLiveWorker] ${logPrefix}: [SafetyGuard] Skipping ${sym}, remaining exposure headroom ($${remainingExposureUsd.toFixed(2)}) < minNotional ($${filter.minNotional}).`
          );
          return null;
        }
        allocUsd = Math.min(rawAllocUsd, remainingExposureUsd);
        const exposureCheck = this.compoundingManager.validateExposure(
          accountEquity,
          exposureCtx.activeNotionalUsd + allocUsd,
          1.0
        );
        if (!exposureCheck.isSafe) {
          console.warn(`[HybridLiveWorker] ${logPrefix}: [SafetyGuard] Skipping ${sym}: ${exposureCheck.reason}`);
          return null;
        }
        const requiredMargin = (allocUsd / targetLeverage) * 1.15;
        if (exposureCtx.availableBalance < requiredMargin) {
          console.warn(
            `[HybridLiveWorker] ${logPrefix}: [SafetyGuard] Skipping ${sym}, availableBalance ($${exposureCtx.availableBalance.toFixed(2)}) < required margin ($${requiredMargin.toFixed(2)}).`
          );
          return null;
        }
      }

      const targetQty = allocUsd / mark;
      const qtyStr = formatToStep(targetQty, filter.stepSize);
      const numQty = parseFloat(qtyStr);
      if (numQty * mark < filter.minNotional || numQty < filter.minQty) {
        console.warn(`[HybridLiveWorker] ${logPrefix}: ${sym} notional ${numQty * mark} < minNotional ${filter.minNotional}`);
        return null;
      }

      await this.ensureSafeLeverage(sym);
      console.log(`[HybridLiveWorker] ${logPrefix}: Opening ${sym} Qty=${qtyStr} (~$${(numQty * mark).toFixed(2)}, SL=${(slPct * 100).toFixed(1)}%)`);
      const order = await this.broker.submitMarketOrder({
        symbol: sym,
        side: 'BUY',
        quantity: qtyStr,
        clientOrderId: `${clientPrefix}_${sym.toLowerCase()}_${Date.now()}`,
        positionSide: 'BOTH',
      });
      const fillPrice = parseFloat(order.avgPrice || mark.toString());
      const slPrice = floorPriceToTick(fillPrice * (1.0 - slPct), filter.tickSize);

      this.ratchetState.delete(sym);
      this.nativeStops.delete(sym);
      this.ratchetState.set(sym, {
        entryPrice: fillPrice,
        currentSl: slPrice,
        initialSlPct: slPct,
        maxRet: 0,
        tier: 'initial',
        entryTime: Date.now(),
      });

      await this.syncNativeStopLoss(sym, numQty, slPrice);
      return { symbol: sym, qty: numQty, entryPrice: fillPrice };
    } catch (err: unknown) {
      console.error(`[HybridLiveWorker] ${logPrefix}: Failed to open candidate ${sym}:`, err);
      return null;
    }
  }

  private updateCachedRegime(
    btcSignal: { oneDayReturn: number; btc14dReturn: number | null; signalAvailable: boolean },
    regime: MomentumRegimeDecision
  ): void {
    if (!btcSignal.signalAvailable) return;
    this.lastMomentumRegime = {
      mode: regime.mode,
      btc1dReturnPct: Number((btcSignal.oneDayReturn * 100).toFixed(2)),
      btc14dReturnPct: btcSignal.btc14dReturn !== null ? Number((btcSignal.btc14dReturn * 100).toFixed(2)) : null,
      maxSlots: regime.maxSlots,
      targetAllocPct: regime.allocPct,
    };
  }

  private async rebalanceMomentum(): Promise<boolean> {
    console.log(`[HybridLiveWorker] Starting 3-day Momentum Rebalance (${OFFICIAL_RELEASE_VERSION} Dynamic)...`);
    try {
      // BTC Crash Trend Health Gate (-3.0% 1d) & Macro Bear Defensive Regime (-10.0% 14d)
      const btcSignal = await fetchBtcGridSignal(this.volatilityGridController);
      const regime = resolveMomentumRegime(btcSignal.oneDayReturn, btcSignal.btc14dReturn, btcSignal.signalAvailable);
      this.updateCachedRegime(btcSignal, regime);
      if (regime.crashBlocked) {
        console.log(
          btcSignal.signalAvailable
            ? `[HybridLiveWorker] [${OFFICIAL_RELEASE_VERSION} BTC Crash Gate] BTC 24h/1d return is ${(btcSignal.oneDayReturn * 100).toFixed(2)}% <= -3.0%. Postponing new Altcoin entries.`
            : `[HybridLiveWorker] [${OFFICIAL_RELEASE_VERSION} BTC Crash Gate] BTC signal unavailable (fail-safe). Postponing new Altcoin entries.`
        );
        if (btcSignal.signalAvailable) {
          const now = Date.now();
          if (now - this.lastBtcCrashAlertTs >= 4 * 3_600_000) {
            this.lastBtcCrashAlertTs = now;
            await sendHybridTelegram(
              `🛡️ [CỬA CHẶN BTC SẬP ${OFFICIAL_RELEASE_VERSION}]: BTC giảm ${(btcSignal.oneDayReturn * 100).toFixed(2)}% (<= -3.0%). Tạm hoãn mở mới Altcoin để bảo vệ vốn!\n` +
              `Hệ thống sẽ tự động quét lại mỗi 30 phút và giải ngân ngay khi đà rơi kết thúc.`
            );
          }
        }
        return false;
      }
      this.lastBtcCrashAlertTs = 0;

      if (regime.mode === 'macro_defensive') {
        console.log(`[HybridLiveWorker] [MacroBearGuard] BTC 14d return ${(btcSignal.btc14dReturn! * 100).toFixed(2)}% <= -10.0%. Defensive mode: max ${regime.maxSlots} slot @ ${(regime.allocPct * 100).toFixed(0)}%.`);
      }

      const universe = this.dynamicUniverseScanner.getUniverse();
      const changes24h = await fetchAll24hChanges();
      const ranked = await computeMomentumUniverse(this.candleCache, universe, changes24h);
      const cooldownExclude = new Set<string>();
      for (const sym of this.sameDaySlCooldown.keys()) {
        if (this.isSymbolInCooldown(sym)) cooldownExclude.add(sym);
      }
      const top2 = await selectTopMomentumSymbols(ranked, regime.maxSlots, 'Rebalance', this.eventShield, cooldownExclude);
      console.log(`[HybridLiveWorker] Rebalance Top ${regime.maxSlots} Momentum (${regime.mode}): ${top2.join(', ') || '(none)'}`);

      // If no qualifying symbols found, schedule a retry in 6h instead of sitting idle
      if (top2.length === 0) {
        this.momentumRetryAt = Date.now() + MOMENTUM_RETRY_INTERVAL_MS;
        const retryTime = new Date(this.momentumRetryAt + ICT_OFFSET).toISOString().slice(11, 16);
        console.log(`[HybridLiveWorker] Rebalance: No symbols meet momentum & funding threshold. Will retry in 6h (~${retryTime} ICT).`);
        await sendHybridTelegram(
          `⏳ TÁI CÂN BẰNG: Không tìm thấy coin nào đạt ngưỡng momentum +2% (14 ngày) kèm Funding Guard an toàn (<= 0.05%/8h).\n` +
          `Giữ nguyên vị thế hiện tại, sẽ thử lại sau 6 tiếng (~${retryTime} ICT).`
        );
        return false;
      }

      // Clear retry timer on successful rebalance
      this.momentumRetryAt = 0;

      const [positions, account] = await Promise.all([
        this.broker.getPositions(),
        this.broker.getAccount(),
      ]);
      const activePositions = positions.filter((p) => Math.abs(parseFloat(p.positionAmt)) > 0);
      const activeMomentum = activePositions.filter((p) => p.symbol !== 'BTCUSDT');
      const accountEquity = parseFloat(account.totalMarginBalance || account.totalWalletBalance || '0');
      let availableBalance = parseFloat(account.availableBalance || '0');
      let activeNotionalUsd = this.computeActiveNotional(activePositions);

      const closedSymbols: string[] = [];
      const openedPositions: Array<{ symbol: string; qty: number; entryPrice: number }> = [];
      const survivingSymbols = new Set<string>();

      // 1. Close non-locked symbols that fell out of target selection (preserve profitable lock1/lock2/lock3 winners)
      for (const p of activeMomentum) {
        if (top2.includes(p.symbol)) {
          survivingSymbols.add(p.symbol);
          continue;
        }
        const currentTier = this.ratchetState.get(p.symbol)?.tier ?? this.activeTrackedPositions.get(p.symbol)?.ratchetTier;
        if (isProfitableLockedTier(currentTier)) {
          console.log(`[HybridLiveWorker] Rebalance: Preserving ${p.symbol} (${currentTier} locked winner) instead of force-closing at market.`);
          survivingSymbols.add(p.symbol);
          continue;
        }
        const qty = parseFloat(p.positionAmt);
        const px = parseFloat(p.markPrice || p.entryPrice || '0');
        console.log(`[HybridLiveWorker] Rebalance: Rotating out of ${p.symbol} (no longer in Top ${regime.maxSlots})`);
        await this.broker.submitMarketOrder({
          symbol: p.symbol,
          side: qty > 0 ? 'SELL' : 'BUY',
          quantity: Math.abs(qty).toString(),
          clientOrderId: `reb_close_${p.symbol.toLowerCase()}_${Date.now()}`,
          positionSide: 'BOTH',
          reduceOnly: true,
        });
        await this.cancelSymbolStops(p.symbol);
        this.ratchetState.delete(p.symbol);
        this.activeTrackedPositions.delete(p.symbol);
        closedSymbols.push(p.symbol);
        activeNotionalUsd = Math.max(0, activeNotionalUsd - Math.abs(qty) * px);
      }

      // 2. Open new symbols in Top selection within remaining slot ceiling
      const targetLeverage = Math.max(1, Math.min(SAFE_FUTURES_LEVERAGE, getMainnetMaxLeverage()));
      for (const sym of top2) {
        if (survivingSymbols.size >= regime.maxSlots) break;
        if (!survivingSymbols.has(sym)) {
          const opened = await this.openMomentumPosition(sym, accountEquity, regime.allocPct, 'reb_open', 'Rebalance', {
            availableBalance,
            activeNotionalUsd,
          });
          if (opened) {
            openedPositions.push(opened);
            survivingSymbols.add(sym);
            const notional = opened.qty * opened.entryPrice;
            activeNotionalUsd += notional;
            availableBalance = Math.max(0, availableBalance - notional / targetLeverage);
          }
        }
      }

      const nextDate = new Date(Date.now() + MOMENTUM_REBALANCE_DAYS * 86_400_000 + ICT_OFFSET).toISOString().slice(0, 10);
      const text = formatHybridRebalanceNotice({
        closed: closedSymbols,
        opened: openedPositions,
        nextRebalanceDate: nextDate,
      });
      await sendHybridTelegram(text);
      return true;
    } catch (err) {
      console.error('[HybridLiveWorker] Error during momentum rebalance:', err);
      return false;
    }
  }

  /**
   * Retry finding momentum symbols after a rebalance that found none.
   * Only opens new positions; does not close existing ones.
   */
  private async retryMomentumEntry(): Promise<boolean> {
    if (this.retryingMomentum) return false;
    this.retryingMomentum = true;
    try {
      const positions = await this.broker.getPositions();
      const activePositions = positions.filter((p) => Math.abs(parseFloat(p.positionAmt)) > 0);
      const activeNonGrid = activePositions.filter((p) => p.symbol !== 'BTCUSDT');

      // BTC Crash Trend Health Gate (-3.0% 1d) & Macro Bear Defensive Regime (-10.0% 14d)
      const btcSignal = await fetchBtcGridSignal(this.volatilityGridController);
      const regime = resolveMomentumRegime(btcSignal.oneDayReturn, btcSignal.btc14dReturn, btcSignal.signalAvailable);
      this.updateCachedRegime(btcSignal, regime);
      if (regime.crashBlocked) {
        console.log(
          btcSignal.signalAvailable
            ? `[HybridLiveWorker] [${OFFICIAL_RELEASE_VERSION} BTC Crash Gate] BTC 1d return is ${(btcSignal.oneDayReturn * 100).toFixed(2)}% <= -3.0%. Skipping momentum retry (15m cooldown).`
            : `[HybridLiveWorker] [${OFFICIAL_RELEASE_VERSION} BTC Crash Gate] BTC signal unavailable (fail-safe). Skipping momentum retry (15m cooldown).`
        );
        this.momentumRetryAt = Date.now() + 15 * 60_000;
        return false;
      }

      const remainingSlots = Math.max(0, regime.maxSlots - activeNonGrid.length);
      if (remainingSlots <= 0) {
        console.log(`[HybridLiveWorker] Momentum sleeve is already full (${activeNonGrid.length}/${regime.maxSlots}, regime=${regime.mode}). Skipping retry.`);
        this.momentumRetryAt = Date.now() + 15 * 60_000;
        return false;
      }

      if (regime.mode === 'macro_defensive') {
        console.log(`[HybridLiveWorker] [MacroBearGuard] BTC 14d return ${(btcSignal.btc14dReturn! * 100).toFixed(2)}% <= -10.0%. Defensive mode: max ${regime.maxSlots} slot @ ${(regime.allocPct * 100).toFixed(0)}%.`);
      }

      const universe = this.dynamicUniverseScanner.getUniverse();
      const changes24h = await fetchAll24hChanges();
      const ranked = await computeMomentumUniverse(this.candleCache, universe, changes24h);
      const retryExclude = new Set<string>();
      for (const p of activePositions) retryExclude.add(p.symbol);
      for (const sym of this.sameDaySlCooldown.keys()) {
        if (this.isSymbolInCooldown(sym)) retryExclude.add(sym);
      }
      const topCandidates = await selectTopMomentumSymbols(
        ranked,
        Math.max(5, remainingSlots),
        'Momentum retry',
        this.eventShield,
        retryExclude
      );
      console.log(`[HybridLiveWorker] Momentum retry candidates: ${topCandidates.join(', ') || '(none)'} (Available slots: ${remainingSlots})`);

      if (topCandidates.length === 0) {
        // Polling retry in 15m instead of 6h to catch cooldown expirations (e.g. 2h ratchet cooldown) and dynamic market opportunities
        this.momentumRetryAt = Date.now() + 15 * 60_000;
        const retryTime = new Date(this.momentumRetryAt + ICT_OFFSET).toISOString().slice(11, 16);
        console.log(`[HybridLiveWorker] Momentum retry: 0 qualifying symbols right now (candidates in cooldown or < +2%). Polling cooldown active for 15m (~${retryTime} ICT).`);
        return false;
      }

      // Found symbols! Open positions up to remainingSlots
      console.log(`[HybridLiveWorker] Momentum retry: Found qualifying symbols, opening up to ${remainingSlots} position(s)...`);
      this.momentumRetryAt = 0;

      const activeSymbols = activePositions.map((p) => p.symbol);
      const openedPositions: Array<{ symbol: string; qty: number; entryPrice: number }> = [];

      const account = await this.broker.getAccount();
      const accountEquity = parseFloat(account.totalMarginBalance || account.totalWalletBalance || '0');
      let availableBalance = parseFloat(account.availableBalance || '0');
      let activeNotionalUsd = this.computeActiveNotional(activePositions);
      const targetLeverage = Math.max(1, Math.min(SAFE_FUTURES_LEVERAGE, getMainnetMaxLeverage()));

      let openedCount = 0;
      for (const sym of topCandidates) {
        if (openedCount >= remainingSlots) break;
        if (activeSymbols.includes(sym)) continue;

        // Differentiated Cooldown check
        if (this.isSymbolInCooldown(sym)) {
          console.log(`[HybridLiveWorker] Momentum retry: Skipping ${sym} (Active Cooldown).`);
          continue;
        }

        const opened = await this.openMomentumPosition(sym, accountEquity, regime.allocPct, 'reb_retry', 'Momentum retry', {
          availableBalance,
          activeNotionalUsd,
        });
        if (opened) {
          openedPositions.push(opened);
          openedCount++;
          const notional = opened.qty * opened.entryPrice;
          activeNotionalUsd += notional;
          availableBalance = Math.max(0, availableBalance - notional / targetLeverage);
        }
      }

      if (openedPositions.length > 0) {
        const nextDate = new Date(Date.now() + MOMENTUM_REBALANCE_DAYS * 86_400_000 + ICT_OFFSET).toISOString().slice(0, 10);
        const text = formatHybridRebalanceNotice({
          closed: [],
          opened: openedPositions,
          nextRebalanceDate: nextDate,
        });
        await sendHybridTelegram(`🔄 RETRY THÀNH CÔNG!\n${text}`);

        // If we still have an open slot within current regime maxSlots, apply 15m polling cooldown to avoid hot loops
        if (activeNonGrid.length + openedPositions.length < regime.maxSlots) {
          this.momentumRetryAt = Date.now() + 15 * 60_000;
        } else {
          this.momentumRetryAt = 0;
        }
        return true;
      } else {
        // No positions could be opened (all candidates were in cooldown, below minNotional, or filtered).
        // Set a 15-minute cooldown to prevent tight-loop polling every 3-second tick.
        this.momentumRetryAt = Date.now() + 15 * 60_000;
        console.log(`[HybridLiveWorker] Momentum retry: 0 positions opened (candidates skipped/cooldown). Polling cooldown active for 15m.`);
        return false;
      }
    } catch (err) {
      console.error('[HybridLiveWorker] Error during momentum retry:', err);
      // Reschedule retry on error
      this.momentumRetryAt = Date.now() + MOMENTUM_RETRY_INTERVAL_MS;
      return false;
    } finally {
      this.retryingMomentum = false;
    }
  }

  /**
   * Emergency close triggered by LLM Event Shield (delisting, exploit, regulatory freeze).
   */
  public async emergencyClosePosition(symbol: string, pos: LivePosition, reason: string): Promise<void> {
    const qty = parseFloat(pos.positionAmt);
    if (Math.abs(qty) === 0) return;
    console.warn(`[HybridLiveWorker] [EventShield] Executing EMERGENCY CLOSE for ${symbol} (${reason})`);
    try {
      await this.broker.submitMarketOrder({
        symbol,
        side: qty > 0 ? 'SELL' : 'BUY',
        quantity: Math.abs(qty).toString(),
        clientOrderId: `shield_close_${symbol.toLowerCase()}_${Date.now()}`.slice(0, 36),
        positionSide: 'BOTH',
        reduceOnly: true,
      });
      await this.cancelSymbolStops(symbol);
      this.ratchetState.delete(symbol);
      this.activeTrackedPositions.delete(symbol);
      this.sameDaySlCooldown.set(symbol, this.getUtcDay());
      await sendHybridTelegram(
        `🚨 [EVENT SHIELD] ĐÃ KHẨN CẤP ĐÓNG VỊ THẾ ${symbol}!\n` +
        `• Lý do: ${reason}\n` +
        `• Khối lượng: ${qty}\n` +
        `• Hành động: Đã bán thoát vị thế và hủy lệnh Stop Loss để bảo toàn trần rủi ro 12 USDT.`
      );
    } catch (err) {
      console.error(`[HybridLiveWorker] [EventShield] Emergency close failed for ${symbol}:`, err);
    }
  }

  /** Resolves actual post-fee realized PnL and closing price from venue fills when available. */
  private async resolveClosedTradeSummary(
    symbol: string,
    qty: number,
    entryPrice: number,
    fallbackSlPrice: number,
    entryTime?: number
  ): Promise<{ exitPrice: number; pnl: number }> {
    const nowMs = Date.now();
    if (typeof this.broker.getUserTrades === 'function') {
      try {
        const minWindowStart = nowMs - 6 * 86_400_000;
        const startTime = entryTime && entryTime > 0
          ? Math.min(nowMs - 60_000, Math.max(minWindowStart, entryTime - 60_000))
          : nowMs - 24 * 3_600_000;
        const trades = await this.broker.getUserTrades({ symbol, startTime, limit: 20 });
        const closingFills = trades.filter((t) => {
          const rPnl = parseFloat(t.realizedPnl);
          return Number.isFinite(rPnl) && rPnl !== 0 && t.time >= startTime;
        });
        if (closingFills.length > 0) {
          let totalNetPnl = 0;
          let totalNotional = 0;
          let totalQty = 0;
          for (const t of closingFills) {
            const rPnl = parseFloat(t.realizedPnl);
            const fee = t.commissionAsset === 'USDT' ? parseFloat(t.commission) : 0;
            const px = parseFloat(t.price);
            const q = parseFloat(t.qty);
            if (Number.isFinite(rPnl)) totalNetPnl += rPnl - (Number.isFinite(fee) ? fee : 0);
            if (Number.isFinite(px) && Number.isFinite(q) && px > 0 && q > 0) {
              totalNotional += px * q;
              totalQty += q;
            }
          }
          const exitPrice = totalQty > 0 ? totalNotional / totalQty : fallbackSlPrice;
          return { exitPrice, pnl: totalNetPnl };
        }
      } catch (err) {
        console.warn(`[HybridLiveWorker] Could not fetch closing userTrades for ${symbol}:`, err instanceof Error ? err.message : err);
      }
    }

    let exitPrice = fallbackSlPrice;
    try {
      const m = await this.broker.getMarkPrices(symbol);
      if (m[0]?.markPrice) exitPrice = parseFloat(m[0].markPrice);
    } catch {}
    return { exitPrice, pnl: (exitPrice - entryPrice) * qty };
  }

  private async tickBtcGrid(): Promise<void> {
    const filter = this.exchangeFilters['BTCUSDT'];
    if (!filter) return;

    // Skip frequent REST polling if no active grid levels and raw 8% ticket cannot afford BTC min order.
    // Still refresh BTC volatility & macro regime once every 200 ticks (~10m).
    if (this.btcGridLevels.length === 0 && this.lastState && this.lastState.accountEquity > 0) {
      const estAffordability = this.compoundingManager.evaluateGridAffordability(
        this.lastState.accountEquity,
        this.lastBtcMarkPrice || 60_000,
        filter.minQty,
        filter.minNotional
      );
      if (!estAffordability.affordable && this.tickCounter % 200 !== 0) {
        return;
      }
    }

    try {
      const [markPrices, btcSignal, account] = await Promise.all([
        this.broker.getMarkPrices('BTCUSDT'),
        fetchBtcGridSignal(this.volatilityGridController),
        this.broker.getAccount(),
      ]);
      const btcMark = parseFloat(markPrices[0]?.markPrice || '0');
      if (btcMark > 0) this.lastBtcMarkPrice = btcMark;
      if (!btcSignal.signalAvailable || btcMark <= 0 || btcSignal.ema10 <= 0) return;

      const regime = resolveMomentumRegime(btcSignal.oneDayReturn, btcSignal.btc14dReturn, btcSignal.signalAvailable);
      this.updateCachedRegime(btcSignal, regime);

      const accountEquity = parseFloat(account.totalMarginBalance || account.totalWalletBalance || '0');
      const availableBalance = parseFloat(account.availableBalance || '0');

      // 1. Check Take Profit on existing active grid levels (synced against real live BTCUSDT position)
      if (this.btcGridLevels.length > 0) {
        const btcPositions = (await this.broker.getPositions('BTCUSDT')).filter((p) => p.symbol === 'BTCUSDT');
        let remainingBtcQty = btcPositions.reduce((sum, p) => {
          const q = parseFloat(p.positionAmt);
          return q > 0 ? sum + q : sum;
        }, 0);

        if (remainingBtcQty <= 0) {
          console.warn('[HybridLiveWorker] BTC Grid state had levels but live BTCUSDT position is 0. Clearing stale btcGridLevels.');
          this.btcGridLevels = [];
          await this.cancelSymbolStops('BTCUSDT');
        } else {
          const survivingLevels: Array<{ entryPrice: number; qty: number; tpPrice: number }> = [];
          for (const lvl of this.btcGridLevels) {
            if (btcMark >= lvl.tpPrice && remainingBtcQty > 0) {
              const sellQty = Math.min(lvl.qty, remainingBtcQty);
              const qtyStr = formatToStep(sellQty, filter.stepSize);
              const numSell = parseFloat(qtyStr);
              if (numSell >= filter.minQty) {
                console.log(`[HybridLiveWorker] BTC Grid Take Profit Triggered! Mark=${btcMark} >= TP=${lvl.tpPrice}`);
                await this.broker.submitMarketOrder({
                  symbol: 'BTCUSDT',
                  side: 'SELL',
                  quantity: qtyStr,
                  clientOrderId: `btc_grid_tp_${Date.now()}`,
                  positionSide: 'BOTH',
                  reduceOnly: true,
                });
                remainingBtcQty = Math.max(0, remainingBtcQty - numSell);
                const pnl = (btcMark - lvl.entryPrice) * numSell;
                await sendHybridTelegram(formatHybridTpNotice({
                  symbol: 'BTCUSDT',
                  qty: numSell,
                  exitPrice: btcMark,
                  pnl,
                }));
              }
            } else {
              survivingLevels.push(lvl);
            }
          }
          this.btcGridLevels = survivingLevels;
          if (this.btcGridLevels.length === 0) {
            await this.cancelSymbolStops('BTCUSDT');
          } else {
            const totalQty = this.btcGridLevels.reduce((s, l) => s + l.qty, 0);
            const avgEntry = this.btcGridLevels.reduce((s, l) => s + l.entryPrice * l.qty, 0) / Math.max(totalQty, 1e-9);
            const catSl = floorPriceToTick(avgEntry * (1.0 - MOMENTUM_SL_PCT), filter.tickSize);
            await this.replaceNativeStopLoss('BTCUSDT', totalQty, catSl);
          }
        }
      }

      // 2. Check Crash Gate: If 1d return < dynamic crash gate, freeze new entries
      if (btcSignal.crashGateTripped) {
        console.warn(`[HybridLiveWorker] BTC Crash Gate Tripped (${(btcSignal.oneDayReturn * 100).toFixed(2)}% < -${(btcSignal.volParams.crashGatePct * 100).toFixed(1)}%)! Freezing new Grid entries.`);
        return;
      }

      // 3. Check Dip Buy Levels with ATR dynamic spacing & strict affordability/exposure guard
      if (this.btcGridLevels.length < BTC_GRID_MAX_LEVELS) {
        const affordability = this.compoundingManager.evaluateGridAffordability(
          accountEquity,
          btcMark,
          filter.minQty,
          filter.minNotional
        );
        if (!affordability.affordable) {
          return;
        }

        const nextLevelIndex = this.btcGridLevels.length + 1;
        const stepPct = btcSignal.volParams.gridStepPct * nextLevelIndex;
        const dipThreshold = btcSignal.ema10 * (1.0 - stepPct);

        if (btcMark <= dipThreshold) {
          const allPositions = await this.broker.getPositions();
          const activeNotional = this.computeActiveNotional(allPositions);
          const targetTicketUsd = affordability.rawTicketUsd;
          const maxExposureUsd = getEffectiveMaxExposureUsd(accountEquity);
          if (activeNotional + targetTicketUsd > maxExposureUsd) {
            console.warn(`[HybridLiveWorker] BTC Grid [SafetyGuard] Skipping level ${nextLevelIndex}: active notional ($${activeNotional.toFixed(2)}) + $${targetTicketUsd} > maxExposure $${maxExposureUsd.toFixed(2)}.`);
            return;
          }
          const targetLeverage = Math.max(1, Math.min(SAFE_FUTURES_LEVERAGE, getMainnetMaxLeverage()));
          if (availableBalance < (targetTicketUsd / targetLeverage) * 1.15) {
            return;
          }

          const targetQty = targetTicketUsd / btcMark;
          const qtyStr = formatToStep(targetQty, filter.stepSize);
          const numQty = parseFloat(qtyStr);

          if (numQty >= filter.minQty && numQty * btcMark >= filter.minNotional) {
            await this.ensureSafeLeverage('BTCUSDT');
            console.log(`[HybridLiveWorker] BTC Grid Entry Level ${nextLevelIndex} Triggered: Mark=${btcMark} <= Dip=${dipThreshold.toFixed(2)} (-${(stepPct * 100).toFixed(1)}%)! Buying $${targetTicketUsd}...`);
            const order = await this.broker.submitMarketOrder({
              symbol: 'BTCUSDT',
              side: 'BUY',
              quantity: qtyStr,
              clientOrderId: `btc_grid_buy_lvl${nextLevelIndex}_${Date.now()}`,
              positionSide: 'BOTH',
            });
            const entryPrice = parseFloat(order.avgPrice || btcMark.toString());
            const tpPrice = entryPrice * (1.0 + btcSignal.volParams.gridTpPct);
            this.btcGridLevels.push({ entryPrice, qty: numQty, tpPrice });

            const totalQty = this.btcGridLevels.reduce((s, l) => s + l.qty, 0);
            const avgEntry = this.btcGridLevels.reduce((s, l) => s + l.entryPrice * l.qty, 0) / Math.max(totalQty, 1e-9);
            const catSl = floorPriceToTick(avgEntry * (1.0 - MOMENTUM_SL_PCT), filter.tickSize);
            await this.replaceNativeStopLoss('BTCUSDT', totalQty, catSl);

            await sendHybridTelegram(
              `⚡ KHỚP LƯỚI BTC TẦNG ${nextLevelIndex} (SLEEVE 2 ATR VOLATILITY GRID)\n` +
              `• MUA ${qtyStr} BTC @ ${entryPrice} (~${targetTicketUsd} USDT)\n` +
              `• Chốt lời kỳ vọng: ${tpPrice.toFixed(2)} (+${(btcSignal.volParams.gridTpPct * 100).toFixed(1)}%)\n` +
              `• Dừng lỗ thảm họa: ${catSl} (-${(MOMENTUM_SL_PCT * 100).toFixed(0)}%)\n` +
              `• Bước lưới biến động ATR: ${(btcSignal.volParams.gridStepPct * 100).toFixed(2)}%\n` +
              `• 10-EMA hiện tại: ${btcSignal.ema10.toFixed(2)}`
            );
          }
        }
      }
    } catch (err) {
      console.warn('[HybridLiveWorker] Error in BTC Grid tick:', err instanceof Error ? err.message : err);
    }
  }

  private async tick(): Promise<void> {
    this.tickCounter++;
    const today = this.getUtcDay();
    if (this.currentDay !== today) {
      console.log(`[HybridLiveWorker] Day roll: ${this.currentDay || 'init'} -> ${today}`);
      const isFirstBoot = !this.currentDay;
      this.currentDay = today;
      this.breakerLatched = false;
      this.worstDayPnl = 0;

      // Purge expired Cooldowns
      for (const sym of Array.from(this.sameDaySlCooldown.keys())) {
        if (!this.isSymbolInCooldown(sym)) {
          this.sameDaySlCooldown.delete(sym);
        }
      }

      // Re-anchor start equity with safe fallback to last observed equity rather than hardcoded 100.0
      try {
        const acc = await this.broker.getAccount();
        const parsedEq = parseFloat(acc.totalMarginBalance || acc.totalWalletBalance || '');
        if (Number.isFinite(parsedEq) && parsedEq > 0) {
          this.dayStartEquity = parsedEq;
        } else if (this.lastState?.accountEquity && this.lastState.accountEquity > 0) {
          this.dayStartEquity = this.lastState.accountEquity;
        }
      } catch {
        if (this.lastState?.accountEquity && this.lastState.accountEquity > 0) {
          this.dayStartEquity = this.lastState.accountEquity;
        }
      }

      // Check 3-day momentum rebalance boundary (including restarts that spanned 00:00 UTC)
      const crossedMidnightOnRestart = isFirstBoot && this.restoredObservedDay !== '' && this.restoredObservedDay < today;
      if (!isFirstBoot || crossedMidnightOnRestart) {
        if (crossedMidnightOnRestart) {
          this.restoredObservedDay = today;
        }
        this.daysSinceRebalance++;
        if (this.daysSinceRebalance >= MOMENTUM_REBALANCE_DAYS && !this.breakerLatched) {
          const rebalanced = await this.rebalanceMomentum();
          if (rebalanced) {
            this.daysSinceRebalance = 0;
            this.lastRebalanceUtcDay = today;
          } else {
            console.log(`[HybridLiveWorker] Rebalance postponed (BTC Gate or No Candidates). Retaining daysSinceRebalance=${this.daysSinceRebalance} to retry periodically.`);
          }
        }
      }
    }

    const [account, positions] = await Promise.all([
      this.broker.getAccount(),
      this.broker.getPositions(),
    ]);

    const activePositions = positions.filter((p) => Math.abs(parseFloat(p.positionAmt)) > 0);
    const activeSymbols = new Set(activePositions.map((p) => p.symbol));

    // Detect closed positions on Binance exchange venue (e.g. native STOP_MARKET triggered)
    for (const [sym, prev] of this.activeTrackedPositions.entries()) {
      if (!activeSymbols.has(sym)) {
        console.warn(`[HybridLiveWorker] [PositionCloseGuard] Detected closed position on Binance for ${sym} (entry=${prev.entryPrice}, qty=${prev.qty})`);
        await this.cancelSymbolStops(sym);
        const rState = this.ratchetState.get(sym);
        const tier = rState?.tier || prev.ratchetTier || 'initial';
        this.ratchetState.delete(sym);

        const todayUtc = this.getUtcDay();
        if (isProfitableRatchetTier(tier)) {
          const expireIso = new Date(Date.now() + PROFIT_LOCK_COOLDOWN_MS).toISOString();
          this.sameDaySlCooldown.set(sym, expireIso);
          console.log(`[HybridLiveWorker] [PositionCloseGuard] Added ${sym} to Profitable Ratchet Cooldown (${PROFIT_LOCK_COOLDOWN_MS / 3_600_000}h until ${expireIso}).`);
        } else {
          this.sameDaySlCooldown.set(sym, todayUtc);
          console.log(`[HybridLiveWorker] [PositionCloseGuard] Added ${sym} to Same-Day SL Cooldown for ${todayUtc}.`);
        }

        const { exitPrice, pnl: approxPnl } = await this.resolveClosedTradeSummary(
          sym,
          prev.qty,
          prev.entryPrice,
          prev.slPrice,
          rState?.entryTime
        );
        const reason =
          tier === 'breakeven'
            ? 'BREAKEVEN'
            : tier === 'risk_reduction'
            ? 'RISK_REDUCTION'
            : isProfitableLockedTier(tier)
            ? 'LOCK_PROFIT'
            : 'STOP_LOSS';
        const notice = formatHybridPositionClosedNotice({
          symbol: sym,
          qty: prev.qty,
          entryPrice: prev.entryPrice,
          exitPrice,
          pnl: approxPnl,
          reason,
        });

        try {
          await sendHybridTelegram(notice);
          console.log(`[HybridLiveWorker] Telegram notice sent for closed position ${sym}`);
        } catch (tgErr) {
          console.error(`[HybridLiveWorker] Failed to send Telegram notice for closed position ${sym}:`, tgErr);
        }

        this.activeTrackedPositions.delete(sym);
        // Eagerly allow immediate momentum retry check to fill vacant slot
        this.momentumRetryAt = 0;
      }
    }

    const closedThisTick = new Set<string>();

    // Phase 4: LLM Event Shield Emergency Close Check
    if (!this.breakerLatched) {
      const emergencySymbols = this.eventShield.getEmergencyCloseSymbols();
      for (const sym of emergencySymbols) {
        const pos = activePositions.find((p) => p.symbol === sym);
        if (pos && Math.abs(parseFloat(pos.positionAmt)) > 0) {
          const entry = this.eventShield.getEntry(sym);
          await this.emergencyClosePosition(sym, pos, entry?.reason || 'Event Shield Critical Alert');
          closedThisTick.add(sym);
        }
      }
    }

    let latestAccount = account;
    let latestActivePositions = activePositions.filter((p) => !closedThisTick.has(p.symbol));
    const latestActiveNonGrid = latestActivePositions.filter((p) => p.symbol !== 'BTCUSDT');

    // If momentum sleeve has fewer than regime target slots and retry is due or uninitialized, try to enter
    const targetMomentumSlots = this.lastMomentumRegime?.maxSlots ?? 2;
    if (latestActiveNonGrid.length < targetMomentumSlots && !this.breakerLatched && (this.momentumRetryAt === 0 || Date.now() >= this.momentumRetryAt)) {
      console.log(`[HybridLiveWorker] Momentum sleeve has ${latestActiveNonGrid.length}/${targetMomentumSlots} positions, checking for qualifying symbols...`);
      const openedAny = await this.retryMomentumEntry();
      if (openedAny) {
        const [refreshedAccount, refreshedPositions] = await Promise.all([
          this.broker.getAccount(),
          this.broker.getPositions(),
        ]);
        latestAccount = refreshedAccount;
        latestActivePositions = refreshedPositions.filter(
          (p) => Math.abs(parseFloat(p.positionAmt)) > 0 && !closedThisTick.has(p.symbol)
        );
      }
    }
    const accountEquity = parseFloat(latestAccount.totalMarginBalance || latestAccount.totalWalletBalance || '0');
    const availableBalance = parseFloat(latestAccount.availableBalance || '0');

    let totalUnrealizedPnl = 0.0;
    const posMap: HybridLiveState['positions'] = {};
    const alerts: Array<{ key: string; text: string }> = [];

    for (const p of latestActivePositions) {
      const qty = parseFloat(p.positionAmt);
      const entry = parseFloat(p.entryPrice);
      const mark = parseFloat(p.markPrice || p.entryPrice);
      const unrl = (mark - entry) * qty;
      totalUnrealizedPnl += unrl;

      const tickSize = this.exchangeFilters[p.symbol]?.tickSize ?? 0;
      let slPrice = qty > 0 ? floorPriceToTick(entry * (1.0 - MOMENTUM_SL_PCT), tickSize) : entry * (1.0 + MOMENTUM_SL_PCT);
      let ratchetTier: 'initial' | 'risk_reduction' | 'breakeven' | 'lock1' | 'lock2' | 'lock3' | 'lock' = 'initial';
      let maxReturnPct = 0.0;
      let positionSlPct: number | undefined;

      if (qty > 0 && p.symbol !== 'BTCUSDT') {
        const currentRet = (mark - entry) / entry;
        let rState = this.ratchetState.get(p.symbol);
        if (!rState || Math.abs(rState.entryPrice - entry) / entry > 0.005) {
          const cachedCandles = this.candleCache.getCandles(p.symbol);
          const symAtr = cachedCandles ? computeSymbolAtr14Pct(cachedCandles) : 0.06;
          // Initial Stop Loss Clamping: max 12% to prevent extreme -18% drawdown
          const initialSlPct = Math.max(0.08, Math.min(0.12, 1.8 * symAtr));
          rState = {
            entryPrice: entry,
            currentSl: floorPriceToTick(entry * (1.0 - initialSlPct), tickSize),
            initialSlPct,
            maxRet: Math.max(0, currentRet),
            tier: 'initial',
            entryTime: Date.now(),
          };
          this.ratchetState.set(p.symbol, rState);
        } else {
          rState.maxRet = Math.max(rState.maxRet, currentRet);
        }

        maxReturnPct = rState.maxRet * 100.0;
        const initialSlPct = rState.initialSlPct || MOMENTUM_SL_PCT;
        positionSlPct = initialSlPct;

        let rawTargetSl = entry * (1.0 - initialSlPct);
        let targetTier: 'initial' | 'risk_reduction' | 'breakeven' | 'lock1' | 'lock2' | 'lock3' | 'lock' = 'initial';

        if (rState.maxRet >= 0.14) {
          rawTargetSl = entry * 1.10;
          targetTier = 'lock3';
        } else if (rState.maxRet >= 0.10) {
          rawTargetSl = entry * 1.06;
          targetTier = 'lock2';
        } else if (rState.maxRet >= 0.07) {
          rawTargetSl = entry * 1.035;
          targetTier = 'lock1';
        } else if (rState.maxRet >= 0.05) {
          rawTargetSl = entry * 1.008;
          targetTier = 'breakeven';
        }
        const targetSl = floorPriceToTick(rawTargetSl, tickSize);

        // Ratchet up if target is higher than current SL (ratchet moves only upward)
        if (targetSl > rState.currentSl * 1.0005) {
          const oldSl = rState.currentSl;
          rState.currentSl = targetSl;
          rState.tier = targetTier;
          console.log(`[HybridLiveWorker] [RatchetGuard] Ratcheting SL for ${p.symbol}: ${oldSl.toFixed(6)} -> ${targetSl.toFixed(6)} (${targetTier.toUpperCase()} tier, MaxRet: +${maxReturnPct.toFixed(1)}%)`);

          if (!this.breakerLatched) {
            const replaced = await this.replaceNativeStopLoss(p.symbol, qty, targetSl);
            if (!replaced) {
              this.nativeStops.delete(p.symbol);
            }
            if (targetTier !== 'initial') {
              const entryTs = rState.entryTime || Date.now();
              alerts.push({
                key: `ratchet:${p.symbol}:${targetTier}:${entryTs}`,
                text: formatHybridRatchetNotice({
                  symbol: p.symbol,
                  tier: targetTier,
                  entryPrice: entry,
                  newSlPrice: targetSl,
                  maxReturnPct,
                }),
              });
            }
          }
        }

        slPrice = rState.currentSl;
        ratchetTier = rState.tier;

        // Time-Decay Loser Pruning (Official Production Architecture)
        const daysHeld = (Date.now() - rState.entryTime) / (24 * 3_600_000);
        if (
          !this.breakerLatched &&
          daysHeld >= PRUNING_DAYS_THRESHOLD &&
          rState.maxRet < PRUNING_MAX_RETURN_THRESH &&
          currentRet <= PRUNING_CURRENT_RETURN_THRESH
        ) {
          console.warn(
            `[HybridLiveWorker] [${OFFICIAL_RELEASE_VERSION} Pruning] PRUNING TRIGGERED for ${p.symbol}: Held ${daysHeld.toFixed(1)}d >= ${PRUNING_DAYS_THRESHOLD}d, MaxRet: +${maxReturnPct.toFixed(1)}% < 2.0%, CurrentRet: ${(currentRet * 100).toFixed(2)}% <= -5.0%. Pruning early to preserve capital!`
          );
          try {
            await this.broker.submitMarketOrder({
              symbol: p.symbol,
              side: 'SELL',
              quantity: Math.abs(qty).toString(),
              clientOrderId: `prune_${p.symbol.toLowerCase()}_${Date.now()}`,
              positionSide: 'BOTH',
              reduceOnly: true,
            });
            await this.cancelSymbolStops(p.symbol);
            this.ratchetState.delete(p.symbol);
            this.sameDaySlCooldown.set(p.symbol, today);
            console.log(
              `[HybridLiveWorker] [${OFFICIAL_RELEASE_VERSION} Pruning] Successfully pruned ${p.symbol} at ${(currentRet * 100).toFixed(2)}%. Added to Same-Day Cooldown.`
            );
            const pruneNotice = formatHybridPruneNotice({
              symbol: p.symbol,
              entryPrice: entry,
              exitPrice: mark,
              lossPct: currentRet * 100.0,
              pnl: (mark - entry) * qty,
              daysHeld: Math.round(daysHeld * 10) / 10,
            });
            alerts.push({ key: `prune:${today}:${p.symbol}:${Date.now()}`, text: pruneNotice });
            void sendHybridTelegram(pruneNotice);
            this.activeTrackedPositions.delete(p.symbol);
            closedThisTick.add(p.symbol);
            this.momentumRetryAt = 0;
            continue;
          } catch (err) {
            console.error(`[HybridLiveWorker] [${OFFICIAL_RELEASE_VERSION} Pruning] Failed to prune ${p.symbol}:`, err);
          }
        }
      }

      posMap[p.symbol] = {
        symbol: p.symbol,
        qty,
        entryPrice: entry,
        markPrice: mark,
        unrlPnl: unrl,
        slPrice,
        slPct: positionSlPct,
        maxReturnPct,
        ratchetTier,
        entryTime: (p.symbol !== 'BTCUSDT' && this.ratchetState.get(p.symbol)?.entryTime) || undefined,
      };

      // Ensure native STOP_MARKET order is on Binance matching engine
      if (!this.breakerLatched && qty > 0) {
        void this.syncNativeStopLoss(p.symbol, qty, slPrice);
      }

      // In-memory fallback check: when native venue stop is verified, allow 1 tick / 0.2% grace so venue STOP_MARKET fills cleanly without -2022 races
      const hasVerifiedVenueStop = this.nativeStops.has(p.symbol);
      const fallbackTriggerSl = hasVerifiedVenueStop
        ? Math.min(slPrice - tickSize, slPrice * 0.998)
        : slPrice;
      if (!this.breakerLatched && qty > 0 && p.symbol !== 'BTCUSDT' && mark <= fallbackTriggerSl) {
        console.warn(`[HybridLiveWorker] STOP LOSS TRIGGERED for ${p.symbol}: Mark=${mark} <= FallbackSL=${fallbackTriggerSl} (${ratchetTier.toUpperCase()})! Closing position...`);
        try {
          await this.broker.submitMarketOrder({
            symbol: p.symbol,
            side: 'SELL',
            quantity: Math.abs(qty).toString(),
            clientOrderId: `sl_${p.symbol.toLowerCase()}_${Date.now()}`,
            positionSide: 'BOTH',
            reduceOnly: true,
          });
          await this.cancelSymbolStops(p.symbol);
          this.ratchetState.delete(p.symbol);
          if (isProfitableRatchetTier(ratchetTier)) {
            const expireIso = new Date(Date.now() + PROFIT_LOCK_COOLDOWN_MS).toISOString();
            this.sameDaySlCooldown.set(p.symbol, expireIso);
            console.log(`[HybridLiveWorker] Added ${p.symbol} to Profitable Ratchet Cooldown (${PROFIT_LOCK_COOLDOWN_MS / 3_600_000}h until ${expireIso}).`);
          } else {
            this.sameDaySlCooldown.set(p.symbol, today);
            console.log(`[HybridLiveWorker] Added ${p.symbol} to Same-Day Stop Loss Cooldown for ${today}.`);
          }
          console.log(`[HybridLiveWorker] STOP LOSS order submitted successfully for ${p.symbol}`);
          const notice = formatHybridStopNotice({ symbol: p.symbol, mark, slPrice, sent: true });
          alerts.push({ key: `sl:${today}:${p.symbol}:${Date.now()}`, text: notice });
          void sendHybridTelegram(notice);
          this.activeTrackedPositions.delete(p.symbol);
          closedThisTick.add(p.symbol);
          this.momentumRetryAt = 0;
        } catch (err) {
          console.error(`[HybridLiveWorker] Failed to execute stop loss for ${p.symbol}:`, err);
          const failNotice = formatHybridStopNotice({ symbol: p.symbol, mark, slPrice, sent: false });
          alerts.push({ key: `sl-fail:${today}:${p.symbol}:${Date.now()}`, text: failNotice });
          void sendHybridTelegram(failNotice);
        }
      }
    }

    // Update tracked positions for currently active positions for next tick (excluding positions closed this tick)
    this.activeTrackedPositions.clear();
    for (const p of latestActivePositions) {
      if (p.symbol === 'BTCUSDT' || closedThisTick.has(p.symbol)) continue;
      const q = parseFloat(p.positionAmt);
      if (Math.abs(q) > 0) {
        const ent = parseFloat(p.entryPrice);
        const rState = this.ratchetState.get(p.symbol);
        const tickSize = this.exchangeFilters[p.symbol]?.tickSize ?? 0;
        const sl = rState?.currentSl ?? (q > 0 ? floorPriceToTick(ent * (1.0 - MOMENTUM_SL_PCT), tickSize) : ent * (1.0 + MOMENTUM_SL_PCT));
        this.activeTrackedPositions.set(p.symbol, {
          qty: Math.abs(q),
          entryPrice: ent,
          slPrice: sl,
          ratchetTier: rState?.tier || 'initial',
        });
      }
    }

    const currentDayPnl = accountEquity - this.dayStartEquity;
    this.worstDayPnl = Math.min(this.worstDayPnl, currentDayPnl);
    const dailyLossLimitUsd = this.compoundingManager.computeDailyLossLimit(this.dayStartEquity);

    // Check Daily Circuit Breaker (12% of dayStartEquity, floor 12.0 USDT)
    if (!this.breakerLatched && currentDayPnl <= -dailyLossLimitUsd) {
      console.error(`[HybridLiveWorker] CIRCUIT BREAKER TRIGGERED! Day PnL=${currentDayPnl.toFixed(2)} <= -${dailyLossLimitUsd.toFixed(2)} USDT. Flattening ALL positions!`);
      this.breakerLatched = true;
      let breakerOk = true;

      for (const p of latestActivePositions) {
        if (closedThisTick.has(p.symbol)) continue;
        const qty = parseFloat(p.positionAmt);
        if (Math.abs(qty) > 0) {
          try {
            await this.broker.submitMarketOrder({
              symbol: p.symbol,
              side: qty > 0 ? 'SELL' : 'BUY',
              quantity: Math.abs(qty).toString(),
              clientOrderId: `breaker_${p.symbol.toLowerCase()}_${Date.now()}`,
              positionSide: 'BOTH',
              reduceOnly: true,
            });
            await this.cancelSymbolStops(p.symbol);
            if (p.symbol !== 'BTCUSDT') {
              this.sameDaySlCooldown.set(p.symbol, today);
            }
            delete posMap[p.symbol];
            console.log(`[HybridLiveWorker] Breaker flatten submitted for ${p.symbol}`);
          } catch (err) {
            breakerOk = false;
            console.error(`[HybridLiveWorker] Breaker flatten error for ${p.symbol}:`, err);
          }
        }
      }
      this.activeTrackedPositions.clear();
      this.ratchetState.clear();
      this.nativeStops.clear();
      this.btcGridLevels = [];
      alerts.push({ key: `breaker:${today}`, text: formatHybridBreakerNotice(currentDayPnl, breakerOk, dailyLossLimitUsd) });
    }

    const activeUniverse = this.dynamicUniverseScanner.getUniverse();
    const volParams = this.volatilityGridController.getLastParams();
    const compoundingSnapshot = this.compoundingManager.getAllocationSnapshot(accountEquity, this.dayStartEquity);

    // Tick BTC Grid every 20 ticks (~60s)
    if (!this.breakerLatched && this.tickCounter % 20 === 0) {
      await this.tickBtcGrid();
    }

    // Check candle cache background prefetch (including 23:55 UTC pre-roll) every 20 ticks
    if (this.tickCounter % 20 === 0) {
      await this.candleCache.checkBackgroundPrefetch(activeUniverse);
    }

    // Periodic dynamic universe & contract status refresh check (every 1200 ticks = ~1 hour)
    if (this.tickCounter % 1200 === 0) {
      await this.loadExchangeFilters();
      const refreshRes = await this.dynamicUniverseScanner.refreshUniverse(false);
      if (refreshRes.refreshed) {
        console.log(`[HybridLiveWorker] Dynamic universe updated: ${refreshRes.symbols.length} symbols. Prefetching candles...`);
        await this.candleCache.prefetchAll(refreshRes.symbols);
      }
    }

    // Periodic Event Shield scan every ~30 minutes (600 ticks)
    if (this.tickCounter % 600 === 0) {
      void this.runEventShieldScan();
    }

    // Periodic retry for overdue rebalance (if postponed by BTC Crash Gate, check early at tick 10 and every ~30m / 600 ticks)
    if (this.daysSinceRebalance >= MOMENTUM_REBALANCE_DAYS && !this.breakerLatched && (this.tickCounter % 600 === 0 || this.tickCounter === 10)) {
      console.log(`[HybridLiveWorker] Retrying overdue momentum rebalance (daysSinceRebalance=${this.daysSinceRebalance})...`);
      const rebalanced = await this.rebalanceMomentum();
      if (rebalanced) {
        this.daysSinceRebalance = 0;
        this.lastRebalanceUtcDay = today;
      }
    }

    // Periodic cross-reconciliation every 15 minutes (300 ticks)
    if (this.tickCounter % RECONCILIATION_INTERVAL_TICKS === 0) {
      await this.reconcileState();
    }

    // Write state
    const state: HybridLiveState = {
      policyId: HYBRID_POLICY_ID,
      status: this.breakerLatched ? 'risk_latched' : 'active',
      lastObservedAt: new Date().toISOString(),
      accountEquity,
      availableBalance,
      dayStartEquity: this.dayStartEquity,
      currentDayPnl,
      worstDayPnl: this.worstDayPnl,
      breakerLatched: this.breakerLatched,
      positions: posMap,
      btcGridLevels: this.btcGridLevels,
      lastRebalanceUtcDay: this.lastRebalanceUtcDay,
      daysSinceRebalance: this.daysSinceRebalance,
      sameDaySlCooldown: Object.fromEntries(this.sameDaySlCooldown),
      momentumRetryAt: this.momentumRetryAt,
      lastReconciledAt: this.lastReconciledAt || undefined,
      candleCacheStatus: {
        size: this.candleCache.size(),
        lastPrefetchAt: this.candleCache.getLastPrefetchAt() || undefined,
      },
      dynamicUniverse: {
        count: activeUniverse.length,
        lastScannedAt: this.dynamicUniverseScanner.getState().lastUpdatedAt,
        topSymbols: activeUniverse.slice(0, 10),
      },
      eventShield: {
        blacklistCount: this.eventShield.getBlacklistedSymbols().length,
        criticalCloseCount: this.eventShield.getEmergencyCloseSymbols().length,
        blacklistedSymbols: this.eventShield.getBlacklistedSymbols(),
        lastScannedAt: this.eventShield.getLastScannedAt() || undefined,
      },
      dynamicCompounding: {
        momentumAllocUsd: this.compoundingManager.computeMomentumAlloc(
          accountEquity,
          undefined,
          this.lastMomentumRegime?.targetAllocPct ?? MOMENTUM_ALLOC_PCT
        ),
        btcGridTicketUsd: compoundingSnapshot.btcGridTicketUsd,
        dailyLossLimitUsd: compoundingSnapshot.dailyLossLimitUsd,
        targetMomentumPct: this.lastMomentumRegime?.targetAllocPct ?? MOMENTUM_ALLOC_PCT,
        targetGridTicketPct: BTC_GRID_TICKET_PCT,
      },
      volatilityGrid: {
        atr14: volParams.atr14,
        atr14Pct: volParams.atr14Pct,
        volMultiplier: volParams.volMultiplier,
        gridStepPct: volParams.gridStepPct,
        gridTpPct: volParams.gridTpPct,
        crashGatePct: volParams.crashGatePct,
        regime: volParams.regime,
      },
      momentumRegime: this.lastMomentumRegime,
      cashFlow: this.cashFlowManager.getSummary(accountEquity),
    };

    this.lastState = state;
    await atomicWriteFile(path.join(this.stateDir, 'worker-status.json'), JSON.stringify(state, null, 2));
    await this.publish(state, alerts);
  }

  private noticeFile(): string {
    return path.join(this.stateDir, 'telegram-sent.json');
  }

  private async loadNotices(): Promise<void> {
    if (this.noticesLoaded) return;
    this.noticesLoaded = true;
    try {
      const raw = JSON.parse(await fs.readFile(this.noticeFile(), 'utf8')) as { keys?: string[] };
      for (const key of (raw.keys ?? []).slice(-MAX_PERSISTED_NOTICES)) this.sentNotices.add(key);
    } catch {
      // First notice for this policy.
    }
  }

  private async publish(state: HybridLiveState, alerts: Array<{ key: string; text: string }>): Promise<void> {
    await this.loadNotices();
    const bookKey = `book:${this.currentDay}:${Object.values(state.positions).map(position => `${position.symbol}:${position.qty}`).sort().join('|')}`;
    const jobs = this.sentNotices.has(bookKey) ? alerts : [{
      key: bookKey,
      text: formatHybridBookNotice({
        positions: Object.values(state.positions),
        equity: state.accountEquity,
        dayPnl: state.currentDayPnl,
        dailyLossLimitUsd: state.dynamicCompounding?.dailyLossLimitUsd,
      }),
    }, ...alerts];
    for (const job of jobs) {
      if (this.sentNotices.has(job.key)) continue;
      try {
        const ids = await sendHybridTelegram(job.text);
        if (!ids.length) return;
        this.sentNotices.add(job.key);
        while (this.sentNotices.size > MAX_PERSISTED_NOTICES) {
          const oldest = this.sentNotices.values().next().value;
          if (!oldest) break;
          this.sentNotices.delete(oldest);
        }
        await atomicWriteFile(this.noticeFile(), JSON.stringify({ keys: [...this.sentNotices] }));
        console.log(`[HybridLiveWorker] telegram_sent ${job.key} ${ids.join(',')}`);
      } catch (error) {
        console.error('[HybridLiveWorker] telegram_error', error instanceof Error ? error.message : error);
        return;
      }
    }
  }
}

// Auto-run if executed directly
if (require.main === module) {
  const worker = new HybridLiveWorker();
  void worker.start();
}

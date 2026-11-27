import dotenv from 'dotenv';
import path from 'node:path';
import os from 'node:os';
import { promises as fs, mkdtempSync } from 'node:fs';
import { createDefaultLiveBroker, type LiveBroker, type LiveExchangeInfo, type LivePosition } from './live-broker';
import {
  OFFICIAL_RELEASE_VERSION,
  formatHybridBookNotice,
  formatHybridBreakerNotice,
  formatHybridStopNotice,
  formatHybridPositionClosedNotice,
  formatHybridRatchetNotice,
  formatHybridRebalanceNotice,
  formatHybridCashFlowNotice,
  sendHybridTelegram,
  startHybridTelegramCommandListener,
} from './hybrid-live-notice';
export { OFFICIAL_RELEASE_VERSION };
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
import {
  BTC_CRASH_LONG_BLOCK_PCT,
  CHANDELIER_ATR_MULT,
  MIN_DAILY_BARS_FOR_TURTLE,
  TURTLE_COOLDOWN_MS,
  TURTLE_FALLING_KNIFE_PCT,
  TURTLE_MAX_SLOT_CAP_PCT,
  ceilPriceToTickSize,
  computeChandelierStop,
  computeEmaSeries,
  computeRiskParityOrderUsd,
  computeTurtleIndicators,
  computeTurtleInitialSlPct,
  evaluateTurtleBreakoutCandidate,
  floorPriceToTickSize,
  getCurrent4hBucketUtc,
  isPositionLockedWinner,
  resolveTurtleDualRegime,
  type ChandelierTier,
  type DailyKlineBar,
  type TurtleCandidate,
  type TurtleDualRegime,
  type TurtleSide,
} from './turtle-dual-strategy';

export * from './turtle-dual-strategy';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const CHECK_INTERVAL_MS = 3_000;
const DAILY_KLINE_FETCH_LIMIT = 100;
const MOMENTUM_SL_PCT = 0.12;
export const MOMENTUM_REBALANCE_DAYS = 3; // Legacy compat export
export const BTC_CRASH_HEALTH_GATE_PCT = BTC_CRASH_LONG_BLOCK_PCT;
export const BTC_MACRO_BEAR_GATE_PCT = -0.10;
export const FALLING_KNIFE_24H_FLOOR_PCT = TURTLE_FALLING_KNIFE_PCT;
export const RATCHET_RISK_REDUCTION_TRIGGER = 0.03;
export const RATCHET_RISK_REDUCTION_SL_PCT = -0.04;
export const PRUNING_DAYS_THRESHOLD = 2.0;
export const PRUNING_MAX_RETURN_THRESH = 0.03;
export const PRUNING_CURRENT_RETURN_THRESH = -0.04;

export type RatchetTier = ChandelierTier | 'risk_reduction' | 'lock1' | 'lock2' | 'lock3';
const SAFE_FUTURES_LEVERAGE = 5;
export const PROFIT_LOCK_COOLDOWN_MS = TURTLE_COOLDOWN_MS;
export const WATCHDOG_TIMEOUT_MS = 35_000;
export const FUNDING_RATE_CAP = 0.0005; // +/- 0.05% per 8h
const RECONCILIATION_INTERVAL_TICKS = 300; // 15 minutes
const REGIME_ALIGNMENT_TICKS = 200; // 10 minutes
const CANDLE_BACKGROUND_REFRESH_MS = 10 * 60_000;
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
  positions: Record<
    string,
    {
      symbol: string;
      side?: TurtleSide;
      qty: number;
      entryPrice: number;
      markPrice: number;
      unrlPnl: number;
      slPrice: number;
      slPct?: number;
      maxReturnPct?: number;
      extremePrice?: number;
      atr14Pct?: number;
      ratchetTier?: RatchetTier;
      entryTime?: number;
    }
  >;
  btcGridLevels: Array<{ entryPrice: number; qty: number; tpPrice: number }>;
  lastScanBucket4h?: string;
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
    turtleMode?: TurtleDualRegime['mode'];
    btcPrice?: number;
    btcEma20?: number;
    btcEma50?: number;
    longSlots?: number;
    shortSlots?: number;
    longBlocked?: boolean;
    shortBlocked?: boolean;
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

export interface Ticker24hStats {
  changePct: number;
  quoteVolume: number;
  lastPrice?: number;
}

export interface BtcDualSignal {
  btcPrice: number;
  btcEma20: number;
  btcEma50: number;
  ema10: number;
  oneDayReturn: number;
  squeezeReturn?: number;
  btc14dReturn: number | null;
  crashGateTripped: boolean;
  signalAvailable: boolean;
  volParams: VolatilityGridParams;
}

function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const text = step.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

export function floorPriceToTick(price: number, tickSize: number): number {
  return floorPriceToTickSize(price, tickSize);
}

export function ceilPriceToTick(price: number, tickSize: number): number {
  return ceilPriceToTickSize(price, tickSize);
}

export function formatToTick(price: number, tickSize: number): string {
  const decimals = stepDecimals(tickSize);
  return floorPriceToTick(price, tickSize).toFixed(decimals);
}

function formatStopPriceForSide(slPrice: number, signedQty: number, tickSize: number): string {
  const decimals = stepDecimals(tickSize);
  const aligned = signedQty >= 0 ? floorPriceToTick(slPrice, tickSize) : ceilPriceToTick(slPrice, tickSize);
  return aligned.toFixed(decimals);
}

function formatToStep(qty: number, stepSize: number): string {
  const decimals = stepDecimals(stepSize);
  const floored = stepSize > 0 ? Math.floor(qty / stepSize + 1e-9) * stepSize : qty;
  return floored.toFixed(decimals);
}

/** Legacy-compatible helper delegating initial-or-trailing ratchet calculation cleanly. */
export function computeRatchetTarget(
  entryPrice: number,
  maxRet: number,
  initialSlPct: number = MOMENTUM_SL_PCT,
  tickSize = 0
): { rawTargetSl: number; targetSl: number; targetTier: RatchetTier } {
  const baseSl = entryPrice * (1.0 - initialSlPct);
  let rawTargetSl = baseSl;
  let targetTier: RatchetTier = 'initial';

  if (maxRet >= 0.14) {
    rawTargetSl = entryPrice * 1.10;
    targetTier = 'lock3';
  } else if (maxRet >= 0.10) {
    rawTargetSl = entryPrice * 1.06;
    targetTier = 'lock2';
  } else if (maxRet >= 0.07) {
    rawTargetSl = entryPrice * 1.035;
    targetTier = 'lock1';
  } else if (maxRet >= 0.05) {
    rawTargetSl = entryPrice * 1.008;
    targetTier = 'breakeven';
  } else if (maxRet >= RATCHET_RISK_REDUCTION_TRIGGER) {
    const riskReductionSl = entryPrice * (1.0 + RATCHET_RISK_REDUCTION_SL_PCT);
    if (riskReductionSl > baseSl) {
      rawTargetSl = riskReductionSl;
      targetTier = 'risk_reduction';
    }
  }

  return {
    rawTargetSl,
    targetSl: floorPriceToTick(rawTargetSl, tickSize),
    targetTier,
  };
}

/** Legacy export preserved for diagnostic test parity (disabled in v2.0.0 live execution). */
export function shouldPruneStagnantLoser(
  entryTimeMs: number,
  nowMs: number,
  maxRet: number,
  currentRet: number
): boolean {
  const daysHeld = (nowMs - entryTimeMs) / (24 * 3_600_000);
  return (
    daysHeld >= PRUNING_DAYS_THRESHOLD &&
    maxRet < PRUNING_MAX_RETURN_THRESH &&
    currentRet <= PRUNING_CURRENT_RETURN_THRESH
  );
}

/** Computes 14-day return from daily candles cleanly (used by telemetry & legacy unit tests). */
export function compute14dReturnFromCandles(
  candles: DailyKlineBar[]
): number | null {
  if (!candles || candles.length < 15) return null;
  const now = Date.now();
  const currentDayUtcMidnight = Math.floor(now / 86_400_000) * 86_400_000;
  const lastCandle = candles[candles.length - 1];

  const targetCandle =
    lastCandle[0] >= currentDayUtcMidnight && candles.length >= 16
      ? candles[candles.length - 2]
      : lastCandle;

  const expectedPastTime = targetCandle[0] - 14 * 86_400_000;
  const baseCandle = candles.find((c) => Math.abs(c[0] - expectedPastTime) < 3_600_000) ?? candles[0];
  if (!baseCandle) return null;

  const targetClose = parseFloat(targetCandle[4]);
  const pastClose = parseFloat(baseCandle[4]);
  if (!Number.isFinite(targetClose) || !Number.isFinite(pastClose) || pastClose <= 0) return null;
  return (targetClose - pastClose) / pastClose;
}

/** Computes 14-day Average True Range percentage (ATR14%) from daily candles. */
export function computeSymbolAtr14Pct(candles: DailyKlineBar[]): number {
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
 * RAM Cache for daily kline bars (`limit=100` for EMA50 + Donchian20 + AvgVol20).
 */
export class CandleRamCache {
  private cache = new Map<string, { fetchedAt: number; candles: DailyKlineBar[] }>();
  private prefetching = false;
  private lastPrefetchAt = 0;
  private prefetch2355DoneDate = '';

  public getCandles(symbol: string): DailyKlineBar[] | null {
    return this.cache.get(symbol)?.candles ?? null;
  }

  public setCandles(symbol: string, candles: DailyKlineBar[]): void {
    this.cache.set(symbol, { fetchedAt: Date.now(), candles });
  }

  public hasSufficientCandles(symbol: string, minBars = 15): boolean {
    const entry = this.cache.get(symbol);
    return !!entry && entry.candles.length >= minBars;
  }

  public size(): number {
    return this.cache.size;
  }

  public getLastPrefetchAt(): number {
    return this.lastPrefetchAt;
  }

  public async prefetchAll(symbols: readonly string[]): Promise<{ successCount: number; failCount: number }> {
    if (this.prefetching) return { successCount: 0, failCount: 0 };
    this.prefetching = true;
    let successCount = 0;
    let failCount = 0;
    const chunkSize = 5;
    const targetList = Array.from(new Set(['BTCUSDT', ...symbols]));

    try {
      for (let i = 0; i < targetList.length; i += chunkSize) {
        const chunk = targetList.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async (sym) => {
            const candles = await fetchCandles1d(sym);
            if (candles) {
              this.setCandles(sym, candles);
              successCount++;
            } else {
              failCount++;
            }
          })
        );
        if (i + chunkSize < targetList.length) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      this.lastPrefetchAt = Date.now();
      console.log(`[HybridLiveWorker] [CandleCache] Prefetch complete: ${successCount}/${targetList.length} symbols cached in RAM (${failCount} failures).`);
    } finally {
      this.prefetching = false;
    }
    return { successCount, failCount };
  }

  public async checkBackgroundPrefetch(symbols: readonly string[]): Promise<void> {
    const now = Date.now();
    const utcDate = new Date(now);
    const utcHours = utcDate.getUTCHours();
    const utcMinutes = utcDate.getUTCMinutes();
    const dateStr = utcDate.toISOString().slice(0, 10);

    if (utcHours === 23 && utcMinutes >= 55 && utcMinutes <= 58) {
      if (this.prefetch2355DoneDate !== dateStr && !this.prefetching) {
        console.log(`[HybridLiveWorker] [CandleCache] Triggering 23:55 UTC pre-roll candle prefetch for ${dateStr}...`);
        this.prefetch2355DoneDate = dateStr;
        await this.prefetchAll(symbols);
        return;
      }
    }

    if (now - this.lastPrefetchAt >= CANDLE_BACKGROUND_REFRESH_MS && !this.prefetching) {
      void this.prefetchAll(symbols);
    }
  }
}

/** Fetches 100 daily Binance Futures kline bars for a symbol. */
export async function fetchCandles1d(symbol: string, limit = DAILY_KLINE_FETCH_LIMIT): Promise<DailyKlineBar[] | null> {
  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=${limit}`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) {
      console.warn(`[HybridLiveWorker] fetchCandles1d ${symbol} failed: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as DailyKlineBar[];
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

export async function fetch14dReturn(symbol: string): Promise<number | null> {
  const data = await fetchCandles1d(symbol);
  return data ? compute14dReturnFromCandles(data) : null;
}

export interface MomentumRegimeDecision {
  mode: 'normal' | 'macro_defensive' | 'crash_freeze';
  crashBlocked: boolean;
  maxSlots: number;
  allocPct: number;
}

/** Legacy compatibility resolver (used by prior diagnostics); live v2.0.0 uses resolveTurtleDualRegime. */
export function resolveMomentumRegime(
  btc1dReturn: number,
  btc14dReturn: number | null,
  signalAvailable = true
): MomentumRegimeDecision {
  if (!signalAvailable || btc1dReturn <= BTC_CRASH_HEALTH_GATE_PCT) {
    return { mode: 'crash_freeze', crashBlocked: true, maxSlots: 0, allocPct: 0 };
  }
  if (btc14dReturn !== null && btc14dReturn <= BTC_MACRO_BEAR_GATE_PCT) {
    return { mode: 'macro_defensive', crashBlocked: false, maxSlots: 1, allocPct: DEFENSIVE_MOMENTUM_ALLOC_PCT };
  }
  return { mode: 'normal', crashBlocked: false, maxSlots: 2, allocPct: MOMENTUM_ALLOC_PCT };
}

/** Fetches rolling 24h return, quote volume (USDT), and live lastPrice for all Binance Futures contracts. */
export async function fetchAll24hMarketStats(): Promise<Map<string, Ticker24hStats>> {
  const map = new Map<string, Ticker24hStats>();
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr', {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return map;
    const data = (await res.json()) as Array<{
      symbol: string;
      priceChangePercent?: string;
      quoteVolume?: string;
      lastPrice?: string;
    }>;
    if (Array.isArray(data)) {
      for (const item of data) {
        const pct = parseFloat(item.priceChangePercent || '');
        const quoteVol = parseFloat(item.quoteVolume || '0');
        const lastPx = parseFloat(item.lastPrice || '');
        if (item.symbol && Number.isFinite(pct)) {
          map.set(item.symbol, {
            changePct: pct / 100,
            quoteVolume: Number.isFinite(quoteVol) ? quoteVol : 0,
            lastPrice: Number.isFinite(lastPx) && lastPx > 0 ? lastPx : undefined,
          });
        }
      }
    }
  } catch (err) {
    console.warn('[HybridLiveWorker] fetchAll24hMarketStats error:', err instanceof Error ? err.message : err);
  }
  return map;
}

export async function fetchAll24hChanges(): Promise<Map<string, number>> {
  const stats = await fetchAll24hMarketStats();
  const out = new Map<string, number>();
  for (const [sym, val] of stats.entries()) {
    out.set(sym, val.changePct);
  }
  return out;
}

function evaluateMomentumCandidate(
  sym: string,
  candles: DailyKlineBar[],
  rolling24hRet?: number
): { symbol: string; score: number; rawReturn: number; atr14Pct: number } | null {
  const rawRet = compute14dReturnFromCandles(candles);
  if (rawRet === null || rawRet < 0.02) return null;
  if (rolling24hRet !== undefined && rolling24hRet <= FALLING_KNIFE_24H_FLOOR_PCT) return null;

  if (candles.length >= 16) {
    const lastBar = candles[candles.length - 1];
    const todayOpen = parseFloat(lastBar[1]);
    const todayClose = parseFloat(lastBar[4]);
    if (todayOpen > 0 && todayClose > 0 && todayOpen !== todayClose) {
      if ((todayClose - todayOpen) / todayOpen <= FALLING_KNIFE_24H_FLOOR_PCT) return null;
      const expected14dTime = lastBar[0] - 14 * 86_400_000;
      const base14dBar = candles.find((c) => Math.abs(c[0] - expected14dTime) < 3_600_000) ?? candles[candles.length - 15];
      const baseClose = base14dBar ? parseFloat(base14dBar[4]) : 0;
      if (baseClose > 0 && (todayClose - baseClose) / baseClose <= 0) return null;
    }
  }

  const atr14Pct = computeSymbolAtr14Pct(candles);
  if (atr14Pct > 0.20) return null;
  return { symbol: sym, score: rawRet, rawReturn: rawRet, atr14Pct };
}

/** Legacy 14d momentum ranker retained for existing test compatibility; live v2.0.0 uses scanTurtleBreakoutCandidates. */
export async function computeMomentumUniverse(
  candleCache?: CandleRamCache,
  universeSymbols?: readonly string[],
  changes24h?: Map<string, number>
): Promise<Array<{ symbol: string; score: number; rawReturn?: number; atr14Pct?: number }>> {
  const targetSymbols = (universeSymbols && universeSymbols.length > 0 ? universeSymbols : SOURCE_MOMENTUM_SYMBOLS).filter((s) => /^[A-Z0-9_]{2,40}$/.test(s));
  const results: Array<{ symbol: string; score: number; rawReturn?: number; atr14Pct?: number }> = [];

  for (const sym of targetSymbols) {
    let candles = candleCache?.getCandles(sym) ?? null;
    if (!candles || candles.length < 15) {
      candles = await fetchCandles1d(sym);
      if (candles) candleCache?.setCandles(sym, candles);
    }
    if (candles && candles.length >= 15) {
      const evaluated = evaluateMomentumCandidate(sym, candles, changes24h?.get(sym));
      if (evaluated) results.push(evaluated);
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

export async function fetchAllFundingRates(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex', {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return map;
    const data = (await res.json()) as Array<{ symbol: string; lastFundingRate: string }>;
    if (Array.isArray(data)) {
      for (const item of data) {
        const rate = parseFloat(item.lastFundingRate);
        if (Number.isFinite(rate)) map.set(item.symbol, rate);
      }
    }
  } catch (err) {
    console.warn('[HybridLiveWorker] fetchAllFundingRates error:', err instanceof Error ? err.message : err);
  }
  return map;
}

export async function selectTopMomentumSymbols(
  ranked: Array<{ symbol: string; score: number }>,
  targetCount = 2,
  logPrefix = 'Rebalance',
  eventShield?: LLMEventShield,
  excludeSymbols?: Set<string>,
  side: TurtleSide = 'LONG',
  preloadedFundingRates?: Map<string, number>
): Promise<string[]> {
  if (ranked.length === 0) return [];
  const fundingRates = preloadedFundingRates ?? (await fetchAllFundingRates());
  const selected: string[] = [];

  for (const candidate of ranked) {
    if (excludeSymbols?.has(candidate.symbol)) continue;
    if (eventShield?.isBlacklisted(candidate.symbol)) {
      const entry = eventShield.getEntry(candidate.symbol);
      console.warn(`[HybridLiveWorker] ${logPrefix}: ${candidate.symbol} skipped by Event Shield (${entry?.category}: ${entry?.reason})`);
      continue;
    }
    const fundingRate = fundingRates.get(candidate.symbol) ?? 0;
    const fundingViolated = side === 'LONG' ? fundingRate > FUNDING_RATE_CAP : fundingRate < -FUNDING_RATE_CAP;
    if (fundingViolated) {
      console.log(`[HybridLiveWorker] ${logPrefix}: ${candidate.symbol} (${side}) skipped due to adverse funding rate (${(fundingRate * 100).toFixed(3)}%)`);
      continue;
    }
    selected.push(candidate.symbol);
    if (selected.length >= targetCount) break;
  }

  return selected;
}

/** Fetches 100 daily BTC candles + 24h ticker to compute true EMA20/EMA50 and Dual L/S regime signals. */
export async function fetchBtcDualSignal(volGridController: VolatilityGridController): Promise<BtcDualSignal> {
  try {
    const [klinesRes, tickerRes] = await Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1d&limit=${DAILY_KLINE_FETCH_LIMIT}`, {
        signal: AbortSignal.timeout(6_000),
      }),
      fetch('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT', {
        signal: AbortSignal.timeout(6_000),
      }),
    ]);
    if (!klinesRes.ok) {
      return {
        btcPrice: 0, btcEma20: 0, btcEma50: 0, ema10: 0,
        oneDayReturn: 0, squeezeReturn: 0, btc14dReturn: null, crashGateTripped: false, signalAvailable: false,
        volParams: volGridController.getLastParams(),
      };
    }
    const data = (await klinesRes.json()) as DailyKlineBar[];
    if (!Array.isArray(data) || data.length < 52) {
      return {
        btcPrice: 0, btcEma20: 0, btcEma50: 0, ema10: 0,
        oneDayReturn: 0, squeezeReturn: 0, btc14dReturn: null, crashGateTripped: false, signalAvailable: false,
        volParams: volGridController.getLastParams(),
      };
    }

    const closes = data.map((k) => parseFloat(k[4])).filter((v) => Number.isFinite(v) && v > 0);
    const lastBar = data[data.length - 1];
    const todayOpen = parseFloat(lastBar[1]);
    const btcPrice = parseFloat(lastBar[4]);
    const todayReturn = todayOpen > 0 ? (btcPrice - todayOpen) / todayOpen : 0;

    let rolling24hReturn = todayReturn;
    if (tickerRes.ok) {
      try {
        const tickerData = (await tickerRes.json()) as { priceChangePercent?: string };
        if (tickerData?.priceChangePercent) {
          const parsed = parseFloat(tickerData.priceChangePercent) / 100;
          if (Number.isFinite(parsed)) rolling24hReturn = parsed;
        }
      } catch {
        rolling24hReturn = todayReturn;
      }
    }

    const ema20Series = computeEmaSeries(closes, 20);
    const ema50Series = computeEmaSeries(closes, 50);
    const btcEma20 = ema20Series[ema20Series.length - 1] ?? btcPrice;
    const btcEma50 = ema50Series[ema50Series.length - 1] ?? btcPrice;

    const ema10Slice = closes.slice(-11, -1);
    const ema10 = ema10Slice.length > 0 ? ema10Slice.reduce((s, v) => s + v, 0) / ema10Slice.length : btcPrice;
    const btc14dReturn = compute14dReturnFromCandles(data);

    const candleData: CandleData[] = data.slice(-20).map((k) => ({
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
    }));
    const volParams = volGridController.computeGridParams(candleData);
    const oneDayReturn = Math.min(todayReturn, rolling24hReturn);
    const squeezeReturn = Math.max(todayReturn, rolling24hReturn);
    const crashGateTripped = oneDayReturn < -volParams.crashGatePct;

    return {
      btcPrice,
      btcEma20,
      btcEma50,
      ema10,
      oneDayReturn,
      squeezeReturn,
      btc14dReturn,
      crashGateTripped,
      signalAvailable: true,
      volParams,
    };
  } catch {
    return {
      btcPrice: 0, btcEma20: 0, btcEma50: 0, ema10: 0,
      oneDayReturn: 0, squeezeReturn: 0, btc14dReturn: null, crashGateTripped: false, signalAvailable: false,
      volParams: volGridController.getLastParams(),
    };
  }
}

export class HybridLiveWorker {
  private broker: LiveBroker;
  private running = false;
  private stateDir: string;
  private dayStartEquity = 100.0;
  private worstDayPnl = 0;
  private currentDay = '';
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
  private turtleCycleInProgress = false;
  private lastScanBucket4h = '';
  private nativeStops = new Set<string>();
  private stopRetryAt = new Map<string, number>();
  private daysSinceRebalance = 0;
  private lastRebalanceUtcDay = '';
  private momentumRetryAt = 0;
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
      side: TurtleSide;
      entryPrice: number;
      currentSl: number;
      initialSlPct: number;
      extremePrice: number;
      maxRet: number;
      atr14Pct: number;
      tier: RatchetTier;
      entryTime: number;
    }
  >();
  public sameDaySlCooldown = new Map<string, string>();
  public activeTrackedPositions = new Map<
    string,
    {
      side: TurtleSide;
      qty: number; // SIGNED (+ Long, - Short)
      entryPrice: number;
      slPrice: number;
      ratchetTier?: RatchetTier;
    }
  >();

  constructor(options?: { stateDir?: string }) {
    this.broker = createDefaultLiveBroker({
      requestTimeoutMs: 8_000,
      retryReads: true,
      executionOwner: process.env.PORTFOLIO_EXECUTION_OWNER?.trim() || HYBRID_POLICY_ID,
    });
    this.stateDir =
      options?.stateDir ||
      (process.env.VITEST === 'true'
        ? mkdtempSync(path.join(os.tmpdir(), 'hybrid-worker-vitest-'))
        : path.resolve(__dirname, '../../data/portfolio-live', HYBRID_POLICY_ID));
  }

  public isSymbolInCooldown(sym: string, nowMs = Date.now()): boolean {
    const cd = this.sameDaySlCooldown.get(sym);
    if (!cd) return false;
    if (cd.includes('T')) {
      const expireMs = new Date(cd).getTime();
      if (Number.isFinite(expireMs) && nowMs < expireMs) return true;
      this.sameDaySlCooldown.delete(sym);
      return false;
    }
    const todayUtc = this.getUtcDay();
    if (cd === todayUtc) return true;
    this.sameDaySlCooldown.delete(sym);
    return false;
  }

  public async start(): Promise<void> {
    console.log(`[HybridLiveWorker] Starting Turtle20 Dual L/S ${OFFICIAL_RELEASE_VERSION} O2+O3_R3.0% @4h (${HYBRID_POLICY_ID})...`);
    await fs.mkdir(this.stateDir, { recursive: true });

    this.running = true;
    this.setupSignalHandlers();

    await this.loadExchangeFilters();
    await this.restoreDayAnchor();
    await this.eventShield.init();

    await this.dynamicUniverseScanner.refreshUniverse(true);
    const activeUniverse = this.dynamicUniverseScanner.getUniverse();
    console.log(`[HybridLiveWorker] Active dynamic universe loaded: ${activeUniverse.length} symbols.`);

    console.log(`[HybridLiveWorker] Warming up 100d candle RAM cache for BTCUSDT + ${activeUniverse.length} universe symbols...`);
    await this.candleCache.prefetchAll(activeUniverse);

    await this.cashFlowManager.load();
    await this.reconcileState();

    // Seed activeTrackedPositions preserving signed qty and side
    try {
      const initialPositions = await this.broker.getPositions();
      for (const p of initialPositions) {
        if (p.symbol === 'BTCUSDT') continue;
        const q = parseFloat(p.positionAmt);
        if (Math.abs(q) > 0) {
          const side: TurtleSide = q > 0 ? 'LONG' : 'SHORT';
          const ent = parseFloat(p.entryPrice);
          const rState = this.ratchetState.get(p.symbol);
          const tickSize = this.exchangeFilters[p.symbol]?.tickSize ?? 0;
          const fallbackSl =
            side === 'LONG'
              ? floorPriceToTick(ent * (1.0 - MOMENTUM_SL_PCT), tickSize)
              : ceilPriceToTick(ent * (1.0 + MOMENTUM_SL_PCT), tickSize);
          this.activeTrackedPositions.set(p.symbol, {
            side,
            qty: q,
            entryPrice: ent,
            slPrice: rState?.currentSl ?? fallbackSl,
            ratchetTier: rState?.tier || 'initial',
          });
        }
      }
    } catch (err) {
      console.warn('[HybridLiveWorker] Could not pre-seed activeTrackedPositions:', err);
    }

    await this.runEventShieldScan();

    if (process.env.HYBRID_EMBEDDED_TELEGRAM_LISTENER === 'true') {
      this.stopTelegramListener = startHybridTelegramCommandListener(() => this.lastState);
    } else {
      console.log('[HybridLiveWorker] Embedded Telegram listener disabled (standalone crypto-telegram-bot handles polling).');
    }

    await this.tick();

    let tickInFlightId = 0;
    let consecutiveTimeouts = 0;
    const loop = async () => {
      while (this.running) {
        if (this.tickInProgress) {
          await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
          continue;
        }
        const myTickId = ++tickInFlightId;
        this.tickInProgress = true;
        let tickPromise: Promise<void> | null = null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false;
        try {
          tickPromise = this.tick();
          await Promise.race([
            tickPromise,
            new Promise((_, reject) => {
              timer = setTimeout(() => {
                timedOut = true;
                reject(new Error(`Tick watchdog timeout (${WATCHDOG_TIMEOUT_MS / 1000}s)`));
              }, WATCHDOG_TIMEOUT_MS);
            }),
          ]);
          consecutiveTimeouts = 0;
        } catch (error) {
          console.error('[HybridLiveWorker] Tick error:', error instanceof Error ? error.message : error);
        } finally {
          if (timer) clearTimeout(timer);
          if (tickPromise) {
            void tickPromise.finally(() => {
              if (tickInFlightId === myTickId) {
                this.tickInProgress = false;
                consecutiveTimeouts = 0;
              }
            });
            if (timedOut) {
              consecutiveTimeouts++;
              if (consecutiveTimeouts >= 3) {
                console.error('[HybridLiveWorker] 3 consecutive tick watchdog timeouts — exiting for PM2 recovery.');
                process.exit(1);
              }
              setTimeout(() => {
                if (tickInFlightId === myTickId && this.tickInProgress) {
                  this.tickInProgress = false;
                }
              }, WATCHDOG_TIMEOUT_MS).unref();
            }
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
      for (const s of info.symbols as any[]) {
        rawContracts.push({
          symbol: s.symbol,
          status: s.status,
          contractType: s.contractType,
          quoteAsset: s.quoteAsset,
          deliveryDate: typeof s.deliveryDate === 'number' ? s.deliveryDate : undefined,
        });
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

  private async restoreDayAnchor(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(this.stateDir, 'worker-status.json'), 'utf8')) as HybridLiveState;
      this.lastState = raw;
      const observed = Date.parse(raw.lastObservedAt);
      if (Array.isArray(raw.btcGridLevels)) {
        this.btcGridLevels = raw.btcGridLevels;
      }
      if (typeof raw.lastScanBucket4h === 'string') {
        this.lastScanBucket4h = raw.lastScanBucket4h;
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
            if (!this.isSymbolInCooldown(sym)) this.sameDaySlCooldown.delete(sym);
          }
        }
      }
      if (raw.positions && typeof raw.positions === 'object') {
        for (const [sym, pos] of Object.entries(raw.positions)) {
          if (pos && typeof pos === 'object' && pos.entryPrice) {
            const side: TurtleSide = pos.side ?? (pos.qty < 0 ? 'SHORT' : 'LONG');
            const maxRet = (pos.maxReturnPct || 0) / 100.0;
            const defaultSl = side === 'LONG' ? pos.entryPrice * 0.88 : pos.entryPrice * 1.12;
            const extremePrice =
              pos.extremePrice ?? (side === 'LONG' ? pos.entryPrice * (1 + maxRet) : pos.entryPrice * Math.max(0.01, 1 - maxRet));
            this.ratchetState.set(sym, {
              side,
              entryPrice: pos.entryPrice,
              currentSl: pos.slPrice || defaultSl,
              initialSlPct: pos.slPct || MOMENTUM_SL_PCT,
              extremePrice,
              maxRet,
              atr14Pct: pos.atr14Pct || 0.06,
              tier: pos.ratchetTier || 'initial',
              entryTime: pos.entryTime || Date.now(),
            });
          }
        }
      }
      this.momentumRetryAt = 0;
      if (!Number.isFinite(observed) || !Number.isFinite(raw.dayStartEquity) || raw.dayStartEquity <= 0) return;
      const observedDay = new Date(observed).toISOString().slice(0, 10);
      if (observedDay !== this.getUtcDay()) return;
      this.currentDay = observedDay;
      this.dayStartEquity = raw.dayStartEquity;
      this.worstDayPnl = Math.min(0, Number.isFinite(raw.worstDayPnl) ? raw.worstDayPnl : 0);
      this.breakerLatched = raw.breakerLatched === true;
      console.log(`[HybridLiveWorker] Restored day anchor ${raw.dayStartEquity} for ${observedDay}, scanBucket4h=${this.lastScanBucket4h || '(none)'}`);
    } catch {
      // First boot has no status file.
    }
  }

  private async submitVenueStopOrder(symbol: string, signedQty: number, slPrice: number): Promise<string | null> {
    const filter = this.exchangeFilters[symbol];
    if (!filter) return null;
    const stopPriceStr = formatStopPriceForSide(slPrice, signedQty, filter.tickSize);
    const qtyStr = formatToStep(Math.abs(signedQty), filter.stepSize);
    const clientOrderId = `sl_${symbol.toLowerCase()}_${Date.now()}`.slice(0, 36);
    await this.broker.submitStopMarketOrder({
      symbol,
      side: signedQty > 0 ? 'SELL' : 'BUY',
      stopPrice: stopPriceStr,
      quantity: qtyStr,
      clientOrderId,
      positionSide: 'BOTH',
      reduceOnly: true,
    });
    this.nativeStops.add(symbol);
    this.stopRetryAt.delete(symbol);
    console.log(`[HybridLiveWorker] Native venue STOP_MARKET placed for ${symbol} (${signedQty > 0 ? 'LONG' : 'SHORT'}): SL=${stopPriceStr}, Qty=${qtyStr}`);
    return clientOrderId;
  }

  private async syncNativeStopLoss(symbol: string, signedQty: number, slPrice: number): Promise<boolean> {
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
      return Boolean(await this.submitVenueStopOrder(symbol, signedQty, slPrice));
    } catch (err) {
      this.stopRetryAt.set(symbol, Date.now() + 60_000);
      console.warn(`[HybridLiveWorker] Could not place native STOP_MARKET for ${symbol}:`, err instanceof Error ? err.message : err);
      return false;
    }
  }

  /** Places replacement STOP_MARKET before cancelling older stops so no naked window occurs on failure. */
  private async replaceNativeStopLoss(symbol: string, signedQty: number, newSlPrice: number): Promise<boolean> {
    try {
      const newClientOrderId = await this.submitVenueStopOrder(symbol, signedQty, newSlPrice);
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

  /** Single shared market-close path for SL fallback, regime flip, circuit breaker, and event shield. */
  private async closePositionAtMarket(
    symbol: string,
    signedQty: number,
    clientPrefix: string,
    setCooldown = true
  ): Promise<void> {
    const filter = this.exchangeFilters[symbol];
    const absQty = Math.abs(signedQty);
    const qtyStr = filter ? formatToStep(absQty, filter.stepSize) : absQty.toString();
    await this.broker.submitMarketOrder({
      symbol,
      side: signedQty > 0 ? 'SELL' : 'BUY',
      quantity: qtyStr,
      clientOrderId: `${clientPrefix}_${symbol.toLowerCase()}_${Date.now()}`.slice(0, 36),
      positionSide: 'BOTH',
      reduceOnly: true,
    });
    await this.cancelSymbolStops(symbol);
    this.ratchetState.delete(symbol);
    this.activeTrackedPositions.delete(symbol);
    if (setCooldown && symbol !== 'BTCUSDT') {
      this.sameDaySlCooldown.set(symbol, new Date(Date.now() + TURTLE_COOLDOWN_MS).toISOString());
    }
  }

  public async reconcileState(): Promise<void> {
    try {
      const [positions, account] = await Promise.all([
        this.broker.getPositions(),
        this.broker.getAccount(),
      ]);

      const livePositions = positions.filter((p) => Math.abs(parseFloat(p.positionAmt)) > 0);
      const liveMap = new Map<string, LivePosition>();
      for (const p of livePositions) liveMap.set(p.symbol, p);

      let discrepancyFound = false;
      let diskState: HybridLiveState | null = null;
      try {
        diskState = JSON.parse(await fs.readFile(path.join(this.stateDir, 'worker-status.json'), 'utf8')) as HybridLiveState;
      } catch {
        // No status file yet
      }

      if (diskState && diskState.positions) {
        for (const [sym, statePos] of Object.entries(diskState.positions)) {
          const live = liveMap.get(sym);
          if (!live) {
            console.warn(`[HybridLiveWorker] [CrossReconciliation] ${sym} missing on Binance (closed/stopped). Resolving...`);
            delete diskState.positions[sym];
            this.nativeStops.delete(sym);
            const rState = this.ratchetState.get(sym);
            const tier = rState?.tier || statePos.ratchetTier || 'initial';
            this.ratchetState.delete(sym);
            this.sameDaySlCooldown.set(sym, new Date(Date.now() + TURTLE_COOLDOWN_MS).toISOString());
            discrepancyFound = true;

            const signedQty = statePos.side === 'SHORT' && statePos.qty > 0 ? -statePos.qty : statePos.qty;
            const { exitPrice, pnl } = await this.resolveClosedTradeSummary(
              sym,
              signedQty,
              statePos.entryPrice,
              statePos.slPrice,
              rState?.entryTime ?? statePos.entryTime
            );
            const reason =
              tier === 'lock' || tier === 'lock1' || tier === 'lock2' || tier === 'lock3'
                ? 'LOCK_PROFIT'
                : tier === 'breakeven'
                ? 'BREAKEVEN'
                : tier === 'chandelier'
                ? 'CHANDELIER'
                : 'STOP_LOSS';
            void sendHybridTelegram(
              formatHybridPositionClosedNotice({
                symbol: sym,
                qty: signedQty,
                entryPrice: statePos.entryPrice,
                exitPrice,
                pnl,
                reason,
              })
            );
          } else {
            const liveQty = parseFloat(live.positionAmt);
            if (Math.abs(liveQty - statePos.qty) > 1e-6) {
              statePos.qty = liveQty;
              statePos.side = liveQty > 0 ? 'LONG' : 'SHORT';
              statePos.entryPrice = parseFloat(live.entryPrice);
              discrepancyFound = true;
            }
          }
        }
      }

      if (diskState) {
        if (!diskState.positions) diskState.positions = {};
        for (const p of livePositions) {
          if (p.symbol !== 'BTCUSDT' && !diskState.positions[p.symbol]) {
            const qty = parseFloat(p.positionAmt);
            const entry = parseFloat(p.entryPrice);
            const mark = parseFloat(p.markPrice || p.entryPrice);
            const side: TurtleSide = qty > 0 ? 'LONG' : 'SHORT';
            const cached = this.candleCache.getCandles(p.symbol);
            const symAtr = (cached ? computeTurtleIndicators(cached)?.atr14Pct : undefined) ?? (cached ? computeSymbolAtr14Pct(cached) : undefined);
            const slPct = symAtr !== undefined ? computeTurtleInitialSlPct(symAtr) : MOMENTUM_SL_PCT;
            diskState.positions[p.symbol] = {
              symbol: p.symbol,
              side,
              qty,
              entryPrice: entry,
              markPrice: mark,
              unrlPnl: (mark - entry) * qty,
              slPrice: side === 'LONG' ? entry * (1.0 - slPct) : entry * (1.0 + slPct),
            };
            discrepancyFound = true;
          }
        }
      }

      if (this.btcGridLevels.length > 0 && !liveMap.has('BTCUSDT')) {
        this.btcGridLevels = [];
        if (diskState) diskState.btcGridLevels = [];
        discrepancyFound = true;
      }

      // Open Algo Orders cross-reconciliation for BOTH Longs & Shorts!
      for (const p of livePositions) {
        if (p.symbol === 'BTCUSDT' && this.btcGridLevels.length === 0) continue;
        const qty = parseFloat(p.positionAmt);
        if (Math.abs(qty) === 0) continue;

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
            console.warn(`[HybridLiveWorker] [CrossReconciliation] Active ${qty > 0 ? 'LONG' : 'SHORT'} ${p.symbol} missing venue STOP_MARKET! Re-placing...`);
            this.nativeStops.delete(p.symbol);
            this.stopRetryAt.delete(p.symbol);
            const tickSize = this.exchangeFilters[p.symbol]?.tickSize ?? 0;
            const ent = parseFloat(p.entryPrice);
            const cached = this.candleCache.getCandles(p.symbol);
            const symAtr = (cached ? computeTurtleIndicators(cached)?.atr14Pct : undefined) ?? (cached ? computeSymbolAtr14Pct(cached) : undefined);
            const slPct = symAtr !== undefined ? computeTurtleInitialSlPct(symAtr) : MOMENTUM_SL_PCT;
            const defaultSl = qty > 0 ? floorPriceToTick(ent * (1.0 - slPct), tickSize) : ceilPriceToTick(ent * (1.0 + slPct), tickSize);
            const slPrice = this.ratchetState.get(p.symbol)?.currentSl ?? defaultSl;
            await this.syncNativeStopLoss(p.symbol, qty, slPrice);
            discrepancyFound = true;
          }
        } catch (err) {
          console.warn(`[HybridLiveWorker] [CrossReconciliation] Algo order check error for ${p.symbol}:`, err instanceof Error ? err.message : err);
        }
      }

      for (const sym of this.nativeStops) {
        if (!liveMap.has(sym)) {
          await this.cancelSymbolStops(sym);
          this.nativeStops.delete(sym);
          if (sym !== 'BTCUSDT') {
            this.sameDaySlCooldown.set(sym, new Date(Date.now() + TURTLE_COOLDOWN_MS).toISOString());
          }
          discrepancyFound = true;
        }
      }

      for (const sym of this.ratchetState.keys()) {
        if (!liveMap.has(sym)) this.ratchetState.delete(sym);
      }

      this.lastReconciledAt = new Date().toISOString();
      if (discrepancyFound && diskState) {
        diskState.lastObservedAt = this.lastReconciledAt;
        diskState.accountEquity = parseFloat(account.totalMarginBalance || account.totalWalletBalance || '0');
        diskState.availableBalance = parseFloat(account.availableBalance || '0');
        diskState.lastReconciledAt = this.lastReconciledAt;
        await atomicWriteFile(path.join(this.stateDir, 'worker-status.json'), JSON.stringify(diskState, null, 2));
        this.lastState = diskState;
      }

      try {
        const { newDeposits, newWithdrawals } = await this.cashFlowManager.syncFromBroker(this.broker);
        const liveEquity = parseFloat(account.totalMarginBalance || account.totalWalletBalance || '0') || this.dayStartEquity;
        const todayUtc = this.getUtcDay();

        for (const dep of newDeposits) {
          if (dep.dateUtc === todayUtc) this.dayStartEquity += dep.amount;
          const summary = this.cashFlowManager.getSummary(liveEquity);
          await sendHybridTelegram(
            formatHybridCashFlowNotice({
              type: 'DEPOSIT',
              amount: dep.amount,
              tranId: dep.tranId,
              cumulativeDeposits: summary.cumulativeDeposits,
              strategyNetPnl: summary.strategyNetPnl,
              strategyRoiPct: summary.strategyRoiPct,
              accountEquity: liveEquity,
            })
          );
        }
        for (const w of newWithdrawals) {
          if (w.dateUtc === todayUtc) this.dayStartEquity = Math.max(0, this.dayStartEquity - w.amount);
          const summary = this.cashFlowManager.getSummary(liveEquity);
          await sendHybridTelegram(
            formatHybridCashFlowNotice({
              type: 'WITHDRAWAL',
              amount: w.amount,
              tranId: w.tranId,
              cumulativeDeposits: summary.cumulativeDeposits,
              strategyNetPnl: summary.strategyNetPnl,
              strategyRoiPct: summary.strategyRoiPct,
              accountEquity: liveEquity,
            })
          );
        }
      } catch (cfErr) {
        console.warn('[HybridLiveWorker] [CashFlow] Sync error during reconciliation:', cfErr);
      }
    } catch (err) {
      console.error('[HybridLiveWorker] [CrossReconciliation] Error:', err instanceof Error ? err.message : err);
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

  /** Opens a LONG or SHORT Risk-Parity position and immediately arms venue STOP_MARKET protection. */
  private async openTurtlePosition(
    candidate: TurtleCandidate,
    accountEquity: number,
    exposureCtx: { availableBalance: number; activeNotionalUsd: number }
  ): Promise<{ symbol: string; side: TurtleSide; qty: number; entryPrice: number; slPrice: number } | null> {
    const sym = candidate.symbol;
    if (!/^[A-Z0-9_]{2,40}$/.test(sym)) return null;
    try {
      const filter = this.exchangeFilters[sym];
      if (!filter) return null;
      const markPrices = await this.broker.getMarkPrices(sym);
      const mark = parseFloat(markPrices[0]?.markPrice || '0');
      if (mark <= 0) return null;

      const maxEffectiveUsd = getEffectiveMaxExposureUsd(accountEquity * 1.05);
      const { allocUsd, skipReason } = computeRiskParityOrderUsd({
        accountEquity,
        side: candidate.side,
        slPct: candidate.slPct,
        activeNotionalUsd: exposureCtx.activeNotionalUsd,
        minNotional: filter.minNotional,
        maxEffectiveExposureUsd: maxEffectiveUsd,
      });
      if (allocUsd <= 0) {
        console.warn(`[HybridLiveWorker] [Turtle4h] Skipping ${sym} (${candidate.side}): ${skipReason}`);
        return null;
      }

      const targetLeverage = Math.max(1, Math.min(SAFE_FUTURES_LEVERAGE, getMainnetMaxLeverage()));
      const requiredMargin = (allocUsd / targetLeverage) * 1.15;
      if (exposureCtx.availableBalance < requiredMargin) {
        console.warn(
          `[HybridLiveWorker] [Turtle4h] Skipping ${sym}, availableBalance ($${exposureCtx.availableBalance.toFixed(2)}) < required margin ($${requiredMargin.toFixed(2)}).`
        );
        return null;
      }

      const qtyStr = formatToStep(allocUsd / mark, filter.stepSize);
      const absQty = parseFloat(qtyStr);
      if (absQty * mark < filter.minNotional || absQty < filter.minQty) {
        console.warn(`[HybridLiveWorker] [Turtle4h] Skipping ${sym}: quantized notional $${(absQty * mark).toFixed(2)} < minNotional $${filter.minNotional}`);
        return null;
      }

      await this.ensureSafeLeverage(sym);
      console.log(
        `[HybridLiveWorker] [Turtle4h] Opening ${candidate.side} ${sym} Qty=${qtyStr} (~$${(absQty * mark).toFixed(2)}, SL=${(candidate.slPct * 100).toFixed(1)}%, VolRatio=${candidate.volRatio.toFixed(2)}x)`
      );
      const order = await this.broker.submitMarketOrder({
        symbol: sym,
        side: candidate.side === 'LONG' ? 'BUY' : 'SELL',
        quantity: qtyStr,
        clientOrderId: `t20_${candidate.side.toLowerCase()}_${sym.toLowerCase()}_${Date.now()}`.slice(0, 36),
        positionSide: 'BOTH',
      });

      const fillPrice = parseFloat(order.avgPrice || mark.toString());
      const signedQty = candidate.side === 'LONG' ? absQty : -absQty;
      const slPrice =
        candidate.side === 'LONG'
          ? floorPriceToTick(fillPrice * (1.0 - candidate.slPct), filter.tickSize)
          : ceilPriceToTick(fillPrice * (1.0 + candidate.slPct), filter.tickSize);

      this.ratchetState.set(sym, {
        side: candidate.side,
        entryPrice: fillPrice,
        currentSl: slPrice,
        initialSlPct: candidate.slPct,
        extremePrice: fillPrice,
        maxRet: 0,
        atr14Pct: candidate.atr14Pct,
        tier: 'initial',
        entryTime: Date.now(),
      });
      this.nativeStops.delete(sym);
      await this.syncNativeStopLoss(sym, signedQty, slPrice);

      return { symbol: sym, side: candidate.side, qty: signedQty, entryPrice: fillPrice, slPrice };
    } catch (err) {
      console.error(`[HybridLiveWorker] [Turtle4h] Failed opening ${candidate.side} ${sym}:`, err);
      return null;
    }
  }

  private updateCachedRegime(btcSignal: BtcDualSignal, regime: TurtleDualRegime): void {
    if (!btcSignal.signalAvailable) return;
    const legacyMode: 'normal' | 'macro_defensive' | 'crash_freeze' =
      regime.mode === 'bull_trend'
        ? 'normal'
        : regime.mode === 'bear_trend' || regime.mode === 'neutral_cash'
        ? 'macro_defensive'
        : 'crash_freeze';

    this.lastMomentumRegime = {
      mode: legacyMode,
      turtleMode: regime.mode,
      btcPrice: Number(btcSignal.btcPrice.toFixed(2)),
      btcEma20: Number(btcSignal.btcEma20.toFixed(2)),
      btcEma50: Number(btcSignal.btcEma50.toFixed(2)),
      longSlots: regime.longSlots,
      shortSlots: regime.shortSlots,
      longBlocked: regime.longBlocked,
      shortBlocked: regime.shortBlocked,
      btc1dReturnPct: Number((btcSignal.oneDayReturn * 100).toFixed(2)),
      btc14dReturnPct: btcSignal.btc14dReturn !== null ? Number((btcSignal.btc14dReturn * 100).toFixed(2)) : null,
      maxSlots: Math.max(regime.longSlots, regime.shortSlots),
      targetAllocPct: TURTLE_MAX_SLOT_CAP_PCT,
    };
  }

  /**
   * Executes Turtle20 Dual L/S O2+O3_R3.0% cycle:
   * 1) Always checks BTC EMA20/EMA50 regime alignment and closes any opposing open positions.
   * 2) When allowEntries=true (@4h cadence), scans Top30 >= $50M universe for Donchian20 + EMA20/50 + Vol>=1.25x breakouts.
   */
  public async runTurtleCycle(allowEntries: boolean): Promise<boolean> {
    if (this.turtleCycleInProgress) return false;
    this.turtleCycleInProgress = true;
    try {
      const btcSignal = await fetchBtcDualSignal(this.volatilityGridController);
      const regime = resolveTurtleDualRegime({
        btcPrice: btcSignal.btcPrice,
        btcEma20: btcSignal.btcEma20,
        btcEma50: btcSignal.btcEma50,
        btc1dReturn: btcSignal.oneDayReturn,
        btcSqueezeReturn: btcSignal.squeezeReturn,
        signalAvailable: btcSignal.signalAvailable,
      });
      this.updateCachedRegime(btcSignal, regime);

      if (!regime.signalAvailable) {
        console.warn('[HybridLiveWorker] [Turtle4h] BTC signal unavailable (fail-safe). Skipping cycle.');
        return false;
      }

      const [positions, account] = await Promise.all([
        this.broker.getPositions(),
        this.broker.getAccount(),
      ]);
      const activePositions = positions.filter((p) => Math.abs(parseFloat(p.positionAmt)) > 0);
      const activeNonGrid = activePositions.filter((p) => p.symbol !== 'BTCUSDT');

      const closedSymbols: string[] = [];
      let activeNotionalUsd = this.computeActiveNotional(activePositions);

      // 1. Regime Alignment: close opposing directional trades cleanly when BTC crosses EMA50
      for (const p of activeNonGrid) {
        const qty = parseFloat(p.positionAmt);
        const side: TurtleSide = qty > 0 ? 'LONG' : 'SHORT';
        const unaligned = (side === 'LONG' && regime.longSlots === 0) || (side === 'SHORT' && regime.shortSlots === 0);
        if (!unaligned) continue;

        const mark = parseFloat(p.markPrice || p.entryPrice || '0');
        const entry = parseFloat(p.entryPrice);
        console.log(`[HybridLiveWorker] [TurtleRegime] Closing unaligned ${side} ${p.symbol} (BTC mode=${regime.mode})`);
        await this.closePositionAtMarket(p.symbol, qty, 'reg_exit', true);
        closedSymbols.push(p.symbol);
        activeNotionalUsd = Math.max(0, activeNotionalUsd - Math.abs(qty) * mark);

        const summary = await this.resolveClosedTradeSummary(p.symbol, qty, entry, mark);
        void sendHybridTelegram(
          formatHybridPositionClosedNotice({
            symbol: p.symbol,
            qty,
            entryPrice: entry,
            exitPrice: summary.exitPrice,
            pnl: summary.pnl,
            reason: 'REGIME_ALIGN',
          })
        );
      }

      if (!allowEntries || this.breakerLatched) {
        return closedSymbols.length > 0;
      }

      const survivingNonGrid = activeNonGrid.filter((p) => !closedSymbols.includes(p.symbol));
      const curLongs = survivingNonGrid.filter((p) => parseFloat(p.positionAmt) > 0).length;
      const curShorts = survivingNonGrid.filter((p) => parseFloat(p.positionAmt) < 0).length;
      const needLongs = !regime.longBlocked ? Math.max(0, regime.longSlots - curLongs) : 0;
      const needShorts = !regime.shortBlocked ? Math.max(0, regime.shortSlots - curShorts) : 0;

      const openedPositions: Array<{ symbol: string; side: TurtleSide; qty: number; entryPrice: number; slPrice: number }> = [];

      if (needLongs > 0 || needShorts > 0) {
        const universe = this.dynamicUniverseScanner
          .getUniverse()
          .filter((s) => s !== 'BTCUSDT' && /^[A-Z0-9_]{2,40}$/.test(s));
        if (this.candleCache.getLastPrefetchAt() > 0 && Date.now() - this.candleCache.getLastPrefetchAt() > 20_000) {
          await this.candleCache.prefetchAll(universe);
        }
        const activeSyms = new Set(survivingNonGrid.map((p) => p.symbol));
        const excludeSet = new Set<string>(activeSyms);
        for (const sym of this.sameDaySlCooldown.keys()) {
          if (this.isSymbolInCooldown(sym)) excludeSet.add(sym);
        }

        const [stats24h, fundingRates] = await Promise.all([
          fetchAll24hMarketStats(),
          fetchAllFundingRates(),
        ]);

        const longCands: TurtleCandidate[] = [];
        const shortCands: TurtleCandidate[] = [];

        for (const sym of universe) {
          if (excludeSet.has(sym)) continue;
          let candles = this.candleCache.getCandles(sym);
          if (!candles) {
            candles = await fetchCandles1d(sym);
            if (candles) this.candleCache.setCandles(sym, candles);
          }
          if (!candles || candles.length < MIN_DAILY_BARS_FOR_TURTLE) continue;

          const stat = stats24h.get(sym);
          const ind = computeTurtleIndicators(candles, {
            livePrice: stat?.lastPrice,
            rolling24hQuoteVol: stat?.quoteVolume,
            rolling24hRet: stat?.changePct,
          });
          if (!ind) continue;

          if (needLongs > 0) {
            const c = evaluateTurtleBreakoutCandidate(sym, ind, 'LONG');
            if (c) longCands.push(c);
          }
          if (needShorts > 0) {
            const c = evaluateTurtleBreakoutCandidate(sym, ind, 'SHORT');
            if (c) shortCands.push(c);
          }
        }

        longCands.sort((a, b) => b.score - a.score);
        shortCands.sort((a, b) => b.score - a.score);

        const accountEquity = parseFloat(account.totalMarginBalance || account.totalWalletBalance || '0');
        let availableBalance = parseFloat(account.availableBalance || '0');
        const targetLeverage = Math.max(1, Math.min(SAFE_FUTURES_LEVERAGE, getMainnetMaxLeverage()));

        const fillSide = async (cands: TurtleCandidate[], count: number, side: TurtleSide) => {
          if (count <= 0 || cands.length === 0) return;
          const approved = await selectTopMomentumSymbols(
            cands,
            count + 2,
            `Turtle4h:${side}`,
            this.eventShield,
            excludeSet,
            side,
            fundingRates
          );
          let openedCount = 0;
          for (const sym of approved) {
            if (openedCount >= count) break;
            const cand = cands.find((c) => c.symbol === sym);
            if (!cand) continue;
            const opened = await this.openTurtlePosition(cand, accountEquity, {
              availableBalance,
              activeNotionalUsd,
            });
            if (opened) {
              openedPositions.push(opened);
              excludeSet.add(sym);
              openedCount++;
              const notl = Math.abs(opened.qty) * opened.entryPrice;
              activeNotionalUsd += notl;
              availableBalance = Math.max(0, availableBalance - notl / targetLeverage);
            }
          }
        };

        await fillSide(longCands, needLongs, 'LONG');
        await fillSide(shortCands, needShorts, 'SHORT');
      }

      const bucket = getCurrent4hBucketUtc();
      if (allowEntries) {
        this.lastScanBucket4h = bucket;
      }
      console.log(
        `[HybridLiveWorker] [Turtle4h] Scan ${bucket} UTC complete: regime=${regime.mode} (L=${regime.longSlots}, S=${regime.shortSlots}), closed=${closedSymbols.length}, opened=${openedPositions.length}`
      );

      if (closedSymbols.length > 0 || openedPositions.length > 0) {
        const regimeLabel =
          regime.mode === 'bull_trend'
            ? `Bull Trend (Tối đa ${regime.longSlots} Long)`
            : regime.mode === 'bear_trend'
            ? `Bear Trend (Tối đa ${regime.shortSlots} Short)`
            : 'Trung tính (Giữ tiền mặt)';
        await sendHybridTelegram(
          formatHybridRebalanceNotice({
            closed: closedSymbols,
            opened: openedPositions,
            scanBucket: bucket,
            regimeLabel,
          })
        );
      }

      return closedSymbols.length > 0 || openedPositions.length > 0;
    } catch (err) {
      console.error('[HybridLiveWorker] [Turtle4h] Error during Turtle cycle:', err);
      return false;
    } finally {
      this.turtleCycleInProgress = false;
    }
  }

  public async emergencyClosePosition(symbol: string, pos: LivePosition, reason: string): Promise<void> {
    const qty = parseFloat(pos.positionAmt);
    if (Math.abs(qty) === 0) return;
    console.warn(`[HybridLiveWorker] [EventShield] Executing EMERGENCY CLOSE for ${symbol} (${reason})`);
    try {
      await this.closePositionAtMarket(symbol, qty, 'shield_close', true);
      await sendHybridTelegram(
        `🚨 [EVENT SHIELD] ĐÃ KHẨN CẤP ĐÓNG VỊ THẾ ${symbol}!\n` +
        `• Lý do: ${reason}\n` +
        `• Khối lượng: ${qty}\n` +
        `• Hành động: Đã đóng vị thế và hủy lệnh Stop Loss để bảo toàn tài khoản.`
      );
    } catch (err) {
      console.error(`[HybridLiveWorker] [EventShield] Emergency close failed for ${symbol}:`, err);
    }
  }

  /** Resolves actual post-fee realized PnL and closing price cleanly for both LONG (+qty) and SHORT (-qty). */
  private async resolveClosedTradeSummary(
    symbol: string,
    signedQty: number,
    entryPrice: number,
    fallbackSlPrice: number,
    entryTime?: number
  ): Promise<{ exitPrice: number; pnl: number }> {
    const nowMs = Date.now();
    if (typeof this.broker.getUserTrades === 'function') {
      try {
        const minWindowStart = nowMs - 6 * 86_400_000;
        const startTime =
          entryTime && entryTime > 0
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
    return { exitPrice, pnl: (exitPrice - entryPrice) * signedQty };
  }

  private async tick(): Promise<void> {
    this.tickCounter++;
    const today = this.getUtcDay();
    if (this.currentDay !== today) {
      console.log(`[HybridLiveWorker] Day roll: ${this.currentDay || 'init'} -> ${today}`);
      this.currentDay = today;
      this.breakerLatched = false;
      this.worstDayPnl = 0;

      for (const sym of Array.from(this.sameDaySlCooldown.keys())) {
        if (!this.isSymbolInCooldown(sym)) this.sameDaySlCooldown.delete(sym);
      }

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
    }

    const [account, positions] = await Promise.all([
      this.broker.getAccount(),
      this.broker.getPositions(),
    ]);

    const activePositions = positions.filter((p) => Math.abs(parseFloat(p.positionAmt)) > 0);
    const activeSymbols = new Set(activePositions.map((p) => p.symbol));

    // 1. Detect exchange-closed positions (native STOP_MARKET triggered or manual close)
    for (const [sym, prev] of this.activeTrackedPositions.entries()) {
      if (!activeSymbols.has(sym)) {
        console.warn(`[HybridLiveWorker] [PositionCloseGuard] Detected closed ${prev.side} position for ${sym}`);
        await this.cancelSymbolStops(sym);
        const rState = this.ratchetState.get(sym);
        const tier = rState?.tier || prev.ratchetTier || 'initial';
        this.ratchetState.delete(sym);
        this.sameDaySlCooldown.set(sym, new Date(Date.now() + TURTLE_COOLDOWN_MS).toISOString());

        const { exitPrice, pnl } = await this.resolveClosedTradeSummary(
          sym,
          prev.qty,
          prev.entryPrice,
          prev.slPrice,
          rState?.entryTime
        );
        const reason =
          tier === 'lock' || tier === 'lock1' || tier === 'lock2' || tier === 'lock3'
            ? 'LOCK_PROFIT'
            : tier === 'breakeven'
            ? 'BREAKEVEN'
            : tier === 'chandelier'
            ? 'CHANDELIER'
            : 'STOP_LOSS';

        try {
          await sendHybridTelegram(
            formatHybridPositionClosedNotice({
              symbol: sym,
              qty: prev.qty,
              entryPrice: prev.entryPrice,
              exitPrice,
              pnl,
              reason,
            })
          );
        } catch (tgErr) {
          console.error(`[HybridLiveWorker] Failed sending close notice for ${sym}:`, tgErr);
        }
        this.activeTrackedPositions.delete(sym);
      }
    }

    const closedThisTick = new Set<string>();

    // 2. LLM Event Shield Emergency Close Check
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

    // 3. @4h Dual Breakout Entry & Regime Check (plus 10-minute off-cadence regime alignment)
    const currentBucket = getCurrent4hBucketUtc();
    const shouldRun4hEntries = !this.breakerLatched && this.lastScanBucket4h !== currentBucket;
    const shouldRunRegimeCheck = !this.breakerLatched && !shouldRun4hEntries && this.tickCounter % REGIME_ALIGNMENT_TICKS === 0;

    if (shouldRun4hEntries || shouldRunRegimeCheck) {
      const mutated = await this.runTurtleCycle(shouldRun4hEntries);
      if (mutated) {
        const [refreshedAccount, refreshedPositions] = await Promise.all([
          this.broker.getAccount(),
          this.broker.getPositions(),
        ]);
        latestAccount = refreshedAccount;
        latestActivePositions = refreshedPositions.filter(
          (p) => Math.abs(parseFloat(p.positionAmt)) > 0 && !closedThisTick.has(p.symbol)
        );
      }
    } else if (this.tickCounter % REGIME_ALIGNMENT_TICKS === 0) {
      const btcSignal = await fetchBtcDualSignal(this.volatilityGridController);
      const regime = resolveTurtleDualRegime({
        btcPrice: btcSignal.btcPrice,
        btcEma20: btcSignal.btcEma20,
        btcEma50: btcSignal.btcEma50,
        btc1dReturn: btcSignal.oneDayReturn,
        btcSqueezeReturn: btcSignal.squeezeReturn,
        signalAvailable: btcSignal.signalAvailable,
      });
      this.updateCachedRegime(btcSignal, regime);
    }

    const accountEquity = parseFloat(latestAccount.totalMarginBalance || latestAccount.totalWalletBalance || '0');
    const availableBalance = parseFloat(latestAccount.availableBalance || '0');

    let totalUnrealizedPnl = 0.0;
    const posMap: HybridLiveState['positions'] = {};
    const alerts: Array<{ key: string; text: string }> = [];

    // 4. Symmetric 3s Chandelier Trailing & Venue SL Monitoring for BOTH LONG and SHORT
    for (const p of latestActivePositions) {
      const qty = parseFloat(p.positionAmt);
      if (Math.abs(qty) === 0) continue;
      const side: TurtleSide = qty > 0 ? 'LONG' : 'SHORT';
      const entry = parseFloat(p.entryPrice);
      const mark = parseFloat(p.markPrice || p.entryPrice);
      const unrl = (mark - entry) * qty;
      totalUnrealizedPnl += unrl;

      const tickSize = this.exchangeFilters[p.symbol]?.tickSize ?? 0;
      let slPrice =
        side === 'LONG'
          ? floorPriceToTick(entry * (1.0 - MOMENTUM_SL_PCT), tickSize)
          : ceilPriceToTick(entry * (1.0 + MOMENTUM_SL_PCT), tickSize);
      let ratchetTier: RatchetTier = 'initial';
      let maxReturnPct = 0.0;
      let positionSlPct: number | undefined;
      let extremePrice = mark;
      let atr14Pct = 0.06;

      if (p.symbol !== 'BTCUSDT') {
        const currentRet = side === 'LONG' ? (mark - entry) / entry : (entry - mark) / entry;
        const cachedCandles = this.candleCache.getCandles(p.symbol);
        const freshInd = cachedCandles ? computeTurtleIndicators(cachedCandles) : null;
        let rState = this.ratchetState.get(p.symbol);
        if (!rState || rState.side !== side || Math.abs(rState.entryPrice - entry) / entry > 0.005) {
          const symAtr = freshInd?.atr14Pct ?? (cachedCandles ? computeSymbolAtr14Pct(cachedCandles) : 0.06);
          const initialSlPct = computeTurtleInitialSlPct(symAtr);
          const initSl =
            side === 'LONG'
              ? floorPriceToTick(entry * (1.0 - initialSlPct), tickSize)
              : ceilPriceToTick(entry * (1.0 + initialSlPct), tickSize);
          rState = {
            side,
            entryPrice: entry,
            currentSl: initSl,
            initialSlPct,
            extremePrice: side === 'LONG' ? Math.max(entry, mark) : Math.min(entry, mark),
            maxRet: Math.max(0, currentRet),
            atr14Pct: symAtr,
            tier: 'initial',
            entryTime: Date.now(),
          };
          this.ratchetState.set(p.symbol, rState);
        } else {
          rState.extremePrice = side === 'LONG' ? Math.max(rState.extremePrice, mark) : Math.min(rState.extremePrice, mark);
          rState.maxRet = Math.max(rState.maxRet, currentRet);
          if (freshInd && freshInd.atr14Pct > 0) {
            rState.atr14Pct = freshInd.atr14Pct;
          }
        }

        const ch = computeChandelierStop({
          side,
          entryPrice: entry,
          extremePrice: rState.extremePrice,
          currentSl: rState.currentSl,
          maxRet: rState.maxRet,
          atr14Pct: rState.atr14Pct,
          tickSize,
        });

        if (ch.shouldUpdate) {
          const oldSl = rState.currentSl;
          rState.currentSl = ch.targetSl;
          rState.tier = ch.tier;
          console.log(
            `[HybridLiveWorker] [Chandelier ${CHANDELIER_ATR_MULT}x ATR] ${p.symbol} (${side}): SL ${oldSl.toFixed(6)} -> ${ch.targetSl.toFixed(6)} (${ch.tier.toUpperCase()}, MaxRet: +${(rState.maxRet * 100).toFixed(1)}%)`
          );

          if (!this.breakerLatched) {
            const replaced = await this.replaceNativeStopLoss(p.symbol, qty, ch.targetSl);
            if (!replaced) this.nativeStops.delete(p.symbol);
            if (ch.tier !== 'initial') {
              alerts.push({
                key: `chandelier:${p.symbol}:${ch.tier}:${rState.entryTime}`,
                text: formatHybridRatchetNotice({
                  symbol: p.symbol,
                  side,
                  tier: ch.tier,
                  entryPrice: entry,
                  newSlPrice: ch.targetSl,
                  maxReturnPct: rState.maxRet * 100.0,
                }),
              });
            }
          }
        }

        slPrice = rState.currentSl;
        ratchetTier = rState.tier;
        maxReturnPct = rState.maxRet * 100.0;
        positionSlPct = rState.initialSlPct;
        extremePrice = rState.extremePrice;
        atr14Pct = rState.atr14Pct;
      }

      posMap[p.symbol] = {
        symbol: p.symbol,
        side,
        qty,
        entryPrice: entry,
        markPrice: mark,
        unrlPnl: unrl,
        slPrice,
        slPct: positionSlPct,
        maxReturnPct,
        extremePrice,
        atr14Pct,
        ratchetTier,
        entryTime: p.symbol !== 'BTCUSDT' ? this.ratchetState.get(p.symbol)?.entryTime : undefined,
      };

      if (!this.breakerLatched) {
        void this.syncNativeStopLoss(p.symbol, qty, slPrice);
      }

      const hasVerifiedVenueStop = this.nativeStops.has(p.symbol);
      const fallbackHit =
        side === 'LONG'
          ? mark <= (hasVerifiedVenueStop ? Math.min(slPrice - tickSize, slPrice * 0.998) : slPrice)
          : mark >= (hasVerifiedVenueStop ? Math.max(slPrice + tickSize, slPrice * 1.002) : slPrice);

      if (!this.breakerLatched && p.symbol !== 'BTCUSDT' && fallbackHit) {
        console.warn(`[HybridLiveWorker] STOP LOSS TRIGGERED (${side}) for ${p.symbol}: Mark=${mark} vs SL=${slPrice}`);
        try {
          await this.closePositionAtMarket(p.symbol, qty, 'sl', true);
          delete posMap[p.symbol];
          const notice = formatHybridStopNotice({ symbol: p.symbol, mark, slPrice, sent: true, qty });
          alerts.push({ key: `sl:${today}:${p.symbol}:${Date.now()}`, text: notice });
          void sendHybridTelegram(notice);
          closedThisTick.add(p.symbol);
        } catch (err) {
          console.error(`[HybridLiveWorker] Failed fallback SL close for ${p.symbol}:`, err);
          const failNotice = formatHybridStopNotice({ symbol: p.symbol, mark, slPrice, sent: false, qty });
          alerts.push({ key: `sl-fail:${today}:${p.symbol}:${Date.now()}`, text: failNotice });
          void sendHybridTelegram(failNotice);
        }
      }
    }

    // Rebuild tracked positions for next tick (preserving signed qty!)
    this.activeTrackedPositions.clear();
    for (const p of latestActivePositions) {
      if (p.symbol === 'BTCUSDT' || closedThisTick.has(p.symbol)) continue;
      const q = parseFloat(p.positionAmt);
      if (Math.abs(q) > 0) {
        const side: TurtleSide = q > 0 ? 'LONG' : 'SHORT';
        const ent = parseFloat(p.entryPrice);
        const rState = this.ratchetState.get(p.symbol);
        const tickSize = this.exchangeFilters[p.symbol]?.tickSize ?? 0;
        const sl =
          rState?.currentSl ??
          (side === 'LONG'
            ? floorPriceToTick(ent * (1.0 - MOMENTUM_SL_PCT), tickSize)
            : ceilPriceToTick(ent * (1.0 + MOMENTUM_SL_PCT), tickSize));
        this.activeTrackedPositions.set(p.symbol, {
          side,
          qty: q,
          entryPrice: ent,
          slPrice: sl,
          ratchetTier: rState?.tier || 'initial',
        });
      }
    }

    const currentDayPnl = accountEquity - this.dayStartEquity;
    this.worstDayPnl = Math.min(this.worstDayPnl, currentDayPnl);
    const dailyLossLimitUsd = this.compoundingManager.computeDailyLossLimit(this.dayStartEquity);

    // 5. Daily Circuit Breaker (-12%, floor 12u) WITH Locked-Winner Exemption (>= +1% SL preserved!)
    if (!this.breakerLatched && currentDayPnl <= -dailyLossLimitUsd) {
      console.error(`[HybridLiveWorker] CIRCUIT BREAKER TRIGGERED! Day PnL=${currentDayPnl.toFixed(2)} <= -${dailyLossLimitUsd.toFixed(2)} USDT.`);
      this.breakerLatched = true;
      let breakerOk = true;
      const preservedLocked: string[] = [];

      for (const p of latestActivePositions) {
        if (closedThisTick.has(p.symbol)) continue;
        const qty = parseFloat(p.positionAmt);
        if (Math.abs(qty) === 0) continue;
        const side: TurtleSide = qty > 0 ? 'LONG' : 'SHORT';
        const entry = parseFloat(p.entryPrice);
        const rState = this.ratchetState.get(p.symbol);
        const slPrice = rState?.currentSl ?? posMap[p.symbol]?.slPrice ?? entry;

        if (p.symbol !== 'BTCUSDT' && isPositionLockedWinner(side, entry, slPrice)) {
          console.log(`[HybridLiveWorker] [BreakerExemption] Preserving locked-profit ${side} winner ${p.symbol} (SL=${slPrice} >= +1% over entry=${entry})`);
          preservedLocked.push(p.symbol);
          continue;
        }

        try {
          await this.closePositionAtMarket(p.symbol, qty, 'breaker', true);
          delete posMap[p.symbol];
        } catch (err) {
          breakerOk = false;
          console.error(`[HybridLiveWorker] Breaker flatten error for ${p.symbol}:`, err);
        }
      }
      if (preservedLocked.length === 0) {
        this.btcGridLevels = [];
      }
      alerts.push({
        key: `breaker:${today}`,
        text: formatHybridBreakerNotice(currentDayPnl, breakerOk, dailyLossLimitUsd, preservedLocked),
      });
    }

    const activeUniverse = this.dynamicUniverseScanner.getUniverse();
    const volParams = this.volatilityGridController.getLastParams();
    const compoundingSnapshot = this.compoundingManager.getAllocationSnapshot(accountEquity, this.dayStartEquity);

    if (this.tickCounter % 20 === 0) {
      await this.candleCache.checkBackgroundPrefetch(activeUniverse);
    }

    if (this.tickCounter % 1200 === 0) {
      await this.loadExchangeFilters();
      const refreshRes = await this.dynamicUniverseScanner.refreshUniverse(false);
      if (refreshRes.refreshed) {
        await this.candleCache.prefetchAll(refreshRes.symbols);
      }
    }

    if (this.tickCounter % 600 === 0) {
      void this.runEventShieldScan();
    }

    if (this.tickCounter % RECONCILIATION_INTERVAL_TICKS === 0) {
      await this.reconcileState();
    }

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
      lastScanBucket4h: this.lastScanBucket4h,
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
          TURTLE_MAX_SLOT_CAP_PCT
        ),
        btcGridTicketUsd: compoundingSnapshot.btcGridTicketUsd,
        dailyLossLimitUsd: compoundingSnapshot.dailyLossLimitUsd,
        targetMomentumPct: TURTLE_MAX_SLOT_CAP_PCT,
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
    } catch {}
  }

  private async publish(state: HybridLiveState, alerts: Array<{ key: string; text: string }>): Promise<void> {
    await this.loadNotices();
    const bookKey = `book:${this.currentDay}:${Object.values(state.positions).map((p) => `${p.symbol}:${p.qty}`).sort().join('|')}`;
    const jobs = this.sentNotices.has(bookKey)
      ? alerts
      : [
          {
            key: bookKey,
            text: formatHybridBookNotice({
              positions: Object.values(state.positions),
              equity: state.accountEquity,
              dayPnl: state.currentDayPnl,
              dailyLossLimitUsd: state.dynamicCompounding?.dailyLossLimitUsd,
            }),
          },
          ...alerts,
        ];
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

if (require.main === module) {
  const worker = new HybridLiveWorker();
  void worker.start();
}

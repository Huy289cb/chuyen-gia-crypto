import dotenv from 'dotenv';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createDefaultLiveBroker, type LiveBroker, type LiveExchangeInfo, type LivePosition } from './live-broker';
import {
  formatHybridBookNotice,
  formatHybridBreakerNotice,
  formatHybridStopNotice,
  formatHybridRebalanceNotice,
  formatHybridTpNotice,
  sendHybridTelegram,
  startHybridTelegramCommandListener,
} from './hybrid-live-notice';
import { SOURCE_MOMENTUM_SYMBOLS } from './market-data';
import { HYBRID_POLICY_ID } from './source-hybrid';
import { DynamicUniverseScanner } from './dynamic-universe';
import { LLMEventShield } from './event-shield';
import { DynamicCompoundingManager, MOMENTUM_ALLOC_PCT, BTC_GRID_TICKET_PCT } from './dynamic-compounding';
import { VolatilityGridController, type VolatilityGridParams, type CandleData } from './volatility-grid';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const ICT_OFFSET = 7 * 3_600_000;
const CHECK_INTERVAL_MS = 3_000;
const MOMENTUM_SL_PCT = 0.12;
const BTC_GRID_MAX_LEVELS = 3;
const MOMENTUM_RETRY_INTERVAL_MS = 6 * 3_600_000; // 6 hours
export const FUNDING_RATE_CAP = 0.0005; // +0.05% per 8h (+0.15% daily)
const RECONCILIATION_INTERVAL_TICKS = 300; // 300 ticks * 3s = 900s = 15 minutes
const CANDLE_BACKGROUND_REFRESH_MS = 10 * 60_000; // 10 minutes

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
  positions: Record<string, { symbol: string; qty: number; entryPrice: number; markPrice: number; unrlPnl: number; slPrice: number }>;
  btcGridLevels: Array<{ entryPrice: number; qty: number; tpPrice: number }>;
  lastRebalanceUtcDay?: string;
  daysSinceRebalance?: number;
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

export function formatToTick(price: number, tickSize: number): string {
  const decimals = stepDecimals(tickSize);
  const floored = tickSize > 0 ? Math.floor(price / tickSize + 1e-9) * tickSize : price;
  return floored.toFixed(decimals);
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

/** REST fallback when RAM cache is missing or cold. */
export async function fetch14dReturn(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=16`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) {
      console.warn(`[HybridLiveWorker] fetch14dReturn ${symbol} failed: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as Array<[number, string, string, string, string, ...unknown[]]>;
    if (!Array.isArray(data) || data.length < 15) {
      console.warn(`[HybridLiveWorker] fetch14dReturn ${symbol} insufficient candles: ${Array.isArray(data) ? data.length : 'not an array'}`);
      return null;
    }
    const ret = compute14dReturnFromCandles(data);
    if (ret === null) {
      console.warn(`[HybridLiveWorker] fetch14dReturn ${symbol} could not compute valid 14d return from candles.`);
      return null;
    }
    return ret;
  } catch (err) {
    console.warn(`[HybridLiveWorker] fetch14dReturn ${symbol} error:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Computes momentum score for universe symbols.
 * Reads instantly from RAM cache (< 50ms). Falls back to REST for missing symbols.
 */
export async function computeMomentumUniverse(
  candleCache?: CandleRamCache,
  universeSymbols?: readonly string[]
): Promise<Array<{ symbol: string; score: number }>> {
  const t0 = Date.now();
  const targetSymbols = universeSymbols && universeSymbols.length > 0 ? universeSymbols : SOURCE_MOMENTUM_SYMBOLS;
  const results: Array<{ symbol: string; score: number }> = [];
  const missingSymbols: string[] = [];

  for (const sym of targetSymbols) {
    let score: number | null = null;
    const cachedCandles = candleCache?.getCandles(sym);
    if (cachedCandles && cachedCandles.length >= 15) {
      score = compute14dReturnFromCandles(cachedCandles);
    }

    if (score === null) {
      missingSymbols.push(sym);
    } else if (score >= 0.02) {
      results.push({ symbol: sym, score });
    }
  }

  // Fallback to REST for missing symbols if cache was incomplete
  if (missingSymbols.length > 0) {
    console.warn(`[HybridLiveWorker] computeMomentumUniverse: ${missingSymbols.length} symbols missing in RAM cache, falling back to REST: ${missingSymbols.join(', ')}`);
    for (const sym of missingSymbols) {
      const ret = await fetch14dReturn(sym);
      if (ret !== null) {
        if (ret >= 0.02) results.push({ symbol: sym, score: ret });
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
  eventShield?: LLMEventShield
): Promise<string[]> {
  if (ranked.length === 0) return [];

  const fundingRates = await fetchAllFundingRates();
  const selected: string[] = [];

  for (const candidate of ranked) {
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
  crashGateTripped: boolean;
  volParams: VolatilityGridParams;
}> {
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1d&limit=20', {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) {
      const volParams = volGridController.getLastParams();
      return { ema10: 0, oneDayReturn: 0, crashGateTripped: false, volParams };
    }
    const data = (await res.json()) as Array<[number, string, string, string, string, ...unknown[]]>;
    if (data.length < 11) {
      const volParams = volGridController.getLastParams();
      return { ema10: 0, oneDayReturn: 0, crashGateTripped: false, volParams };
    }
    const closes = data.slice(-11, -1).map((k) => parseFloat(k[4] as string));
    const yesterdayClose = closes[closes.length - 1];
    const dayBeforeYesterday = closes[closes.length - 2];
    const oneDayReturn = (yesterdayClose - dayBeforeYesterday) / dayBeforeYesterday;
    const ema10 = closes.reduce((sum, v) => sum + v, 0) / closes.length;

    const candleData: CandleData[] = data.map((k) => ({
      high: parseFloat(k[2] as string),
      low: parseFloat(k[3] as string),
      close: parseFloat(k[4] as string),
    }));
    const volParams = volGridController.computeGridParams(candleData);
    const crashGateTripped = oneDayReturn < -volParams.crashGatePct;
    return { ema10, oneDayReturn, crashGateTripped, volParams };
  } catch {
    const volParams = volGridController.getLastParams();
    return { ema10: 0, oneDayReturn: 0, crashGateTripped: false, volParams };
  }
}

export class HybridLiveWorker {
  private broker: LiveBroker;
  private running = false;
  private stateDir: string;
  private dayStartEquity = 100.0;
  private currentDay = '';
  private breakerLatched = false;
  private sentNotices = new Set<string>();
  private noticesLoaded = false;
  private lastState: HybridLiveState | null = null;
  private stopTelegramListener: (() => void) | null = null;
  private exchangeFilters: Record<string, SymbolFilterInfo> = {};
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

  constructor() {
    this.broker = createDefaultLiveBroker({
      requestTimeoutMs: 5_000,
      retryReads: true,
      executionOwner: process.env.PORTFOLIO_EXECUTION_OWNER?.trim() || HYBRID_POLICY_ID,
    });
    this.stateDir = path.resolve(__dirname, '../../data/portfolio-live', HYBRID_POLICY_ID);
  }

  public async start(): Promise<void> {
    console.log(`[HybridLiveWorker] Starting Phase 4 Dynamic Universe & Event Shield Multi-Sleeve Live Worker (${HYBRID_POLICY_ID})...`);
    await fs.mkdir(this.stateDir, { recursive: true });

    this.running = true;
    this.setupSignalHandlers();

    await this.loadExchangeFilters();
    await this.restoreDayAnchor();

    // Initialize Phase 4 Event Shield
    await this.eventShield.init();

    // Initialize Phase 4 Dynamic Universe Scanner (Top 30 Binance Futures > $50M/d)
    await this.dynamicUniverseScanner.refreshUniverse();
    const activeUniverse = this.dynamicUniverseScanner.getUniverse();
    console.log(`[HybridLiveWorker] Active dynamic universe loaded: ${activeUniverse.length} symbols.`);

    // Warm up candle RAM cache for zero-latency momentum calculations
    console.log(`[HybridLiveWorker] Warming up candle RAM cache for ${activeUniverse.length} dynamic universe symbols...`);
    await this.candleCache.prefetchAll(activeUniverse);

    // Initial cross-reconciliation with exchange ground truth
    await this.reconcileState();

    // Start interactive Telegram listener (/status, /report, /lenh, /pnl)
    this.stopTelegramListener = startHybridTelegramCommandListener(() => this.lastState);

    // Initial tick
    await this.tick();

    // Run continuous loop with 15s watchdog per tick to prevent Axios/Node socket hangs
    const loop = async () => {
      while (this.running) {
        try {
          await Promise.race([
            this.tick(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Tick watchdog timeout (15s)')), 15_000)
            ),
          ]);
        } catch (error) {
          console.error('[HybridLiveWorker] Tick error:', error instanceof Error ? error.message : error);
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
    return new Date(Date.now() + ICT_OFFSET).toISOString().slice(0, 10);
  }

  private async loadExchangeFilters(): Promise<void> {
    try {
      const info: LiveExchangeInfo = await this.broker.getExchangeInfo();
      for (const s of info.symbols) {
        const lot = s.filters.find((f: Record<string, unknown>) => f.filterType === 'LOT_SIZE') as Record<string, string> | undefined;
        const price = s.filters.find((f: Record<string, unknown>) => f.filterType === 'PRICE_FILTER') as Record<string, string> | undefined;
        const notional = s.filters.find((f: Record<string, unknown>) => f.filterType === 'MIN_NOTIONAL') as Record<string, string> | undefined;
        if (lot && price) {
          this.exchangeFilters[s.symbol] = {
            stepSize: parseFloat(lot.stepSize || '1'),
            tickSize: parseFloat(price.tickSize || '0.0001'),
            minQty: parseFloat(lot.minQty || '1'),
            minNotional: parseFloat(notional?.notional || '5.0'),
          };
        }
      }
      console.log(`[HybridLiveWorker] Loaded exchange filters for ${Object.keys(this.exchangeFilters).length} symbols.`);
    } catch (err) {
      console.warn('[HybridLiveWorker] Could not load exchange filters on start:', err);
    }
  }

  /** Keep the 12 USDT day anchor, rebalance state, and grid state across restarts. */
  private async restoreDayAnchor(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(this.stateDir, 'worker-status.json'), 'utf8')) as HybridLiveState;
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
      if (typeof raw.momentumRetryAt === 'number' && raw.momentumRetryAt > Date.now()) {
        this.momentumRetryAt = raw.momentumRetryAt;
      }
      if (!Number.isFinite(observed) || !Number.isFinite(raw.dayStartEquity) || raw.dayStartEquity <= 0) return;
      const observedDay = new Date(observed + ICT_OFFSET).toISOString().slice(0, 10);
      if (observedDay !== this.getUtcDay()) return;
      this.currentDay = observedDay;
      this.dayStartEquity = raw.dayStartEquity;
      this.breakerLatched = raw.breakerLatched === true;
      console.log(`[HybridLiveWorker] Restored day anchor ${raw.dayStartEquity} for ${observedDay}, daysSinceRebalance: ${this.daysSinceRebalance}`);
    } catch {
      // First boot has no status file.
    }
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
      const stopPriceStr = formatToTick(slPrice, filter.tickSize);
      const qtyStr = formatToStep(Math.abs(qty), filter.stepSize);
      await this.broker.submitStopMarketOrder({
        symbol,
        side: qty > 0 ? 'SELL' : 'BUY',
        stopPrice: stopPriceStr,
        quantity: qtyStr,
        clientOrderId: `sl_${symbol.toLowerCase()}_${Date.now()}`.slice(0, 36),
        positionSide: 'BOTH',
        reduceOnly: true,
      });
      this.nativeStops.add(symbol);
      console.log(`[HybridLiveWorker] Native venue STOP_MARKET placed for ${symbol}: SL=${stopPriceStr}, Qty=${qtyStr}`);
      return true;
    } catch (err) {
      this.stopRetryAt.set(symbol, Date.now() + 60_000);
      console.warn(`[HybridLiveWorker] Could not place native STOP_MARKET for ${symbol}:`, err instanceof Error ? err.message : err);
      return false;
    }
  }

  private async cancelSymbolStops(symbol: string): Promise<void> {
    this.nativeStops.delete(symbol);
    try {
      const algoOrders = await this.broker.getOpenAlgoOrders(symbol);
      for (const order of algoOrders) {
        const clientAlgoId = String(order.clientAlgoId ?? order.clientOrderId ?? order.algoId ?? '');
        if ((order.orderType === 'STOP_MARKET' || order.type === 'STOP_MARKET') && clientAlgoId) {
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
            discrepancyFound = true;
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

      // 2. Open Algo Orders cross-reconciliation
      for (const p of livePositions) {
        if (p.symbol === 'BTCUSDT') continue;
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
            const slPrice = parseFloat(p.entryPrice) * (1.0 - MOMENTUM_SL_PCT);
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
          discrepancyFound = true;
        }
      }

      this.lastReconciledAt = new Date().toISOString();

      if (discrepancyFound && diskState) {
        diskState.lastObservedAt = new Date().toISOString();
        diskState.accountEquity = parseFloat(account.totalMarginBalance || account.totalWalletBalance || '0');
        diskState.availableBalance = parseFloat(account.availableBalance || '0');
        diskState.lastReconciledAt = this.lastReconciledAt;
        await fs.writeFile(path.join(this.stateDir, 'worker-status.json'), JSON.stringify(diskState, null, 2));
        this.lastState = diskState;
        console.log('[HybridLiveWorker] [CrossReconciliation] State file updated with reconciled data.');
      }

      console.log(`[HybridLiveWorker] [CrossReconciliation] Audit completed at tick ${this.tickCounter}: ${livePositions.length} live positions, ${this.nativeStops.size} active stop orders verified. Discrepancies resolved: ${discrepancyFound}`);
    } catch (err) {
      console.error('[HybridLiveWorker] [CrossReconciliation] Error during reconciliation:', err instanceof Error ? err.message : err);
    }
  }

  private async rebalanceMomentum(): Promise<void> {
    console.log('[HybridLiveWorker] Starting 2-day Momentum Rebalance (Phase 4 Dynamic)...');
    try {
      const universe = this.dynamicUniverseScanner.getUniverse();
      const ranked = await computeMomentumUniverse(this.candleCache, universe);
      const top2 = await selectTopMomentumSymbols(ranked, 2, 'Rebalance', this.eventShield);
      console.log(`[HybridLiveWorker] Rebalance Top 2 Momentum: ${top2.join(', ') || '(none)'}`);

      // If no qualifying symbols found, schedule a retry in 6h instead of sitting idle
      if (top2.length === 0) {
        this.momentumRetryAt = Date.now() + MOMENTUM_RETRY_INTERVAL_MS;
        const retryTime = new Date(this.momentumRetryAt + ICT_OFFSET).toISOString().slice(11, 16);
        console.log(`[HybridLiveWorker] Rebalance: No symbols meet momentum & funding threshold. Will retry in 6h (~${retryTime} ICT).`);
        await sendHybridTelegram(
          `⏳ TÁI CÂN BẰNG: Không tìm thấy coin nào đạt ngưỡng momentum +2% (14 ngày) kèm Funding Guard an toàn (<= 0.05%/8h).\n` +
          `Giữ nguyên vị thế hiện tại, sẽ thử lại sau 6 tiếng (~${retryTime} ICT).`
        );
        return;
      }

      // Clear retry timer on successful rebalance
      this.momentumRetryAt = 0;

      const positions = await this.broker.getPositions();
      const activePositions = positions.filter((p) => Math.abs(parseFloat(p.positionAmt)) > 0);
      const activeSymbols = activePositions.map((p) => p.symbol);

      const closedSymbols: string[] = [];
      const openedPositions: Array<{ symbol: string; qty: number; entryPrice: number }> = [];

      // 1. Close symbols that fell out of Top 2 (excluding BTC if held in grid)
      for (const p of activePositions) {
        if (p.symbol === 'BTCUSDT' && this.btcGridLevels.length > 0) continue;
        if (!top2.includes(p.symbol)) {
          const qty = parseFloat(p.positionAmt);
          console.log(`[HybridLiveWorker] Rebalance: Rotating out of ${p.symbol} (no longer in Top 2)`);
          await this.broker.submitMarketOrder({
            symbol: p.symbol,
            side: qty > 0 ? 'SELL' : 'BUY',
            quantity: Math.abs(qty).toString(),
            clientOrderId: `reb_close_${p.symbol.toLowerCase()}_${Date.now()}`,
            positionSide: 'BOTH',
            reduceOnly: true,
          });
          await this.cancelSymbolStops(p.symbol);
          closedSymbols.push(p.symbol);
        }
      }

      const account = await this.broker.getAccount();
      const accountEquity = parseFloat(account.totalMarginBalance || account.totalWalletBalance || '0');

      // 2. Open new symbols in Top 2
      for (const sym of top2) {
        if (!activeSymbols.includes(sym)) {
          const filter = this.exchangeFilters[sym];
          if (!filter) continue;
          const markPrices = await this.broker.getMarkPrices(sym);
          const mark = parseFloat(markPrices[0]?.markPrice || '0');
          if (mark <= 0) continue;

          const allocUsd = this.compoundingManager.computeMomentumAlloc(accountEquity, filter.minNotional);
          const targetQty = allocUsd / mark;
          const qtyStr = formatToStep(targetQty, filter.stepSize);
          const numQty = parseFloat(qtyStr);
          if (numQty * mark < filter.minNotional || numQty < filter.minQty) {
            console.warn(`[HybridLiveWorker] Rebalance: ${sym} notional ${numQty * mark} < minNotional ${filter.minNotional}`);
            continue;
          }

          console.log(`[HybridLiveWorker] Rebalance: Opening Top 2 position ${sym} Qty=${qtyStr} (~$${allocUsd})`);
          const order = await this.broker.submitMarketOrder({
            symbol: sym,
            side: 'BUY',
            quantity: qtyStr,
            clientOrderId: `reb_open_${sym.toLowerCase()}_${Date.now()}`,
            positionSide: 'BOTH',
          });
          const fillPrice = parseFloat(order.avgPrice || mark.toString());
          const slPrice = fillPrice * (1.0 - MOMENTUM_SL_PCT);
          openedPositions.push({ symbol: sym, qty: numQty, entryPrice: fillPrice });

          await this.syncNativeStopLoss(sym, numQty, slPrice);
        }
      }

      const nextDate = new Date(Date.now() + 2 * 86_400_000 + ICT_OFFSET).toISOString().slice(0, 10);
      const text = formatHybridRebalanceNotice({
        closed: closedSymbols,
        opened: openedPositions,
        nextRebalanceDate: nextDate,
      });
      await sendHybridTelegram(text);
    } catch (err) {
      console.error('[HybridLiveWorker] Error during momentum rebalance:', err);
    }
  }

  /**
   * Retry finding momentum symbols after a rebalance that found none.
   * Only opens new positions; does not close existing ones.
   */
  private async retryMomentumEntry(): Promise<void> {
    try {
      const universe = this.dynamicUniverseScanner.getUniverse();
      const ranked = await computeMomentumUniverse(this.candleCache, universe);
      const top2 = await selectTopMomentumSymbols(ranked, 2, 'Momentum retry', this.eventShield);
      console.log(`[HybridLiveWorker] Momentum retry Top 2: ${top2.join(', ') || '(none)'}`);

      if (top2.length === 0) {
        // Still nothing — schedule another retry in 6h
        this.momentumRetryAt = Date.now() + MOMENTUM_RETRY_INTERVAL_MS;
        const retryTime = new Date(this.momentumRetryAt + ICT_OFFSET).toISOString().slice(11, 16);
        console.log(`[HybridLiveWorker] Momentum retry: Still no qualifying symbols. Next retry ~${retryTime} ICT.`);
        await sendHybridTelegram(
          `⏳ Thử lại momentum: Vẫn chưa có coin nào đạt ngưỡng +2% kèm Funding Guard an toàn (<= 0.05%/8h).\n` +
          `Sẽ thử lại sau 6 tiếng (~${retryTime} ICT).`
        );
        return;
      }

      // Found symbols! Open positions
      console.log('[HybridLiveWorker] Momentum retry: Found qualifying symbols, opening positions...');
      this.momentumRetryAt = 0;

      const positions = await this.broker.getPositions();
      const activeSymbols = positions.filter((p) => Math.abs(parseFloat(p.positionAmt)) > 0).map((p) => p.symbol);
      const openedPositions: Array<{ symbol: string; qty: number; entryPrice: number }> = [];

      const account = await this.broker.getAccount();
      const accountEquity = parseFloat(account.totalMarginBalance || account.totalWalletBalance || '0');

      for (const sym of top2) {
        if (activeSymbols.includes(sym)) continue;
        const filter = this.exchangeFilters[sym];
        if (!filter) continue;
        const markPrices = await this.broker.getMarkPrices(sym);
        const mark = parseFloat(markPrices[0]?.markPrice || '0');
        if (mark <= 0) continue;

        const allocUsd = this.compoundingManager.computeMomentumAlloc(accountEquity, filter.minNotional);
        const targetQty = allocUsd / mark;
        const qtyStr = formatToStep(targetQty, filter.stepSize);
        const numQty = parseFloat(qtyStr);
        if (numQty * mark < filter.minNotional || numQty < filter.minQty) {
          console.warn(`[HybridLiveWorker] Momentum retry: ${sym} notional ${numQty * mark} < minNotional ${filter.minNotional}`);
          continue;
        }

        console.log(`[HybridLiveWorker] Momentum retry: Opening ${sym} Qty=${qtyStr} (~$${allocUsd})`);
        const order = await this.broker.submitMarketOrder({
          symbol: sym,
          side: 'BUY',
          quantity: qtyStr,
          clientOrderId: `reb_retry_${sym.toLowerCase()}_${Date.now()}`,
          positionSide: 'BOTH',
        });
        const fillPrice = parseFloat(order.avgPrice || mark.toString());
        const slPrice = fillPrice * (1.0 - MOMENTUM_SL_PCT);
        openedPositions.push({ symbol: sym, qty: numQty, entryPrice: fillPrice });
        await this.syncNativeStopLoss(sym, numQty, slPrice);
      }

      if (openedPositions.length > 0) {
        const nextDate = new Date(Date.now() + 2 * 86_400_000 + ICT_OFFSET).toISOString().slice(0, 10);
        const text = formatHybridRebalanceNotice({
          closed: [],
          opened: openedPositions,
          nextRebalanceDate: nextDate,
        });
        await sendHybridTelegram(`🔄 RETRY THÀNH CÔNG!\n${text}`);
      }
    } catch (err) {
      console.error('[HybridLiveWorker] Error during momentum retry:', err);
      // Reschedule retry on error
      this.momentumRetryAt = Date.now() + MOMENTUM_RETRY_INTERVAL_MS;
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

  private async tickBtcGrid(): Promise<void> {
    const filter = this.exchangeFilters['BTCUSDT'];
    if (!filter) return;

    try {
      const [markPrices, btcSignal, account] = await Promise.all([
        this.broker.getMarkPrices('BTCUSDT'),
        fetchBtcGridSignal(this.volatilityGridController),
        this.broker.getAccount(),
      ]);
      const btcMark = parseFloat(markPrices[0]?.markPrice || '0');
      if (btcMark <= 0 || btcSignal.ema10 <= 0) return;

      const accountEquity = parseFloat(account.totalMarginBalance || account.totalWalletBalance || '0');

      // 1. Check Take Profit on existing active grid levels
      const survivingLevels: Array<{ entryPrice: number; qty: number; tpPrice: number }> = [];
      for (const lvl of this.btcGridLevels) {
        if (btcMark >= lvl.tpPrice) {
          console.log(`[HybridLiveWorker] BTC Grid Take Profit Triggered! Mark=${btcMark} >= TP=${lvl.tpPrice}`);
          const qtyStr = formatToStep(lvl.qty, filter.stepSize);
          await this.broker.submitMarketOrder({
            symbol: 'BTCUSDT',
            side: 'SELL',
            quantity: qtyStr,
            clientOrderId: `btc_grid_tp_${Date.now()}`,
            positionSide: 'BOTH',
            reduceOnly: true,
          });
          const pnl = (btcMark - lvl.entryPrice) * lvl.qty;
          const text = formatHybridTpNotice({
            symbol: 'BTCUSDT',
            qty: lvl.qty,
            exitPrice: btcMark,
            pnl,
          });
          await sendHybridTelegram(text);
        } else {
          survivingLevels.push(lvl);
        }
      }
      this.btcGridLevels = survivingLevels;

      // 2. Check Crash Gate: If 1d return < dynamic crash gate, freeze new entries
      if (btcSignal.crashGateTripped) {
        console.warn(`[HybridLiveWorker] BTC Crash Gate Tripped (${(btcSignal.oneDayReturn * 100).toFixed(2)}% < -${(btcSignal.volParams.crashGatePct * 100).toFixed(1)}%)! Freezing new Grid entries.`);
        return;
      }

      // 3. Check Dip Buy Levels with ATR dynamic spacing
      if (this.btcGridLevels.length < BTC_GRID_MAX_LEVELS) {
        const nextLevelIndex = this.btcGridLevels.length + 1;
        const stepPct = btcSignal.volParams.gridStepPct * nextLevelIndex;
        const dipThreshold = btcSignal.ema10 * (1.0 - stepPct);

        if (btcMark <= dipThreshold) {
          const targetTicketUsd = this.compoundingManager.computeGridTicket(accountEquity, filter.minNotional);
          const targetQty = targetTicketUsd / btcMark;
          const qtyStr = formatToStep(targetQty, filter.stepSize);
          const numQty = parseFloat(qtyStr);

          if (numQty * btcMark >= filter.minNotional) {
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
            await sendHybridTelegram(
              `⚡ KHỚP LƯỚI BTC TẦNG ${nextLevelIndex} (SLEEVE 2 ATR VOLATILITY GRID)\n` +
              `• MUA ${qtyStr} BTC @ ${entryPrice} (~${targetTicketUsd} USDT)\n` +
              `• Chốt lời kỳ vọng: ${tpPrice.toFixed(2)} (+${(btcSignal.volParams.gridTpPct * 100).toFixed(1)}%)\n` +
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

      // Re-anchor start equity
      try {
        const acc = await this.broker.getAccount();
        this.dayStartEquity = parseFloat(acc.totalMarginBalance || acc.totalWalletBalance || '100');
      } catch {
        this.dayStartEquity = 100.0;
      }

      // Check 2-day rebalance boundary
      if (!isFirstBoot) {
        this.daysSinceRebalance++;
        if (this.daysSinceRebalance >= 2 && !this.breakerLatched) {
          await this.rebalanceMomentum();
          this.daysSinceRebalance = 0;
          this.lastRebalanceUtcDay = today;
        }
      }
    }

    const [account, positions] = await Promise.all([
      this.broker.getAccount(),
      this.broker.getPositions(),
    ]);

    const activePositions = positions.filter((p) => Math.abs(parseFloat(p.positionAmt)) > 0);
    const activeNonGrid = activePositions.filter((p) => p.symbol !== 'BTCUSDT');

    // Phase 4: LLM Event Shield Emergency Close Check
    if (!this.breakerLatched) {
      const emergencySymbols = this.eventShield.getEmergencyCloseSymbols();
      for (const sym of emergencySymbols) {
        const pos = activePositions.find((p) => p.symbol === sym);
        if (pos && Math.abs(parseFloat(pos.positionAmt)) > 0) {
          const entry = this.eventShield.getEntry(sym);
          await this.emergencyClosePosition(sym, pos, entry?.reason || 'Event Shield Critical Alert');
        }
      }
    }

    // If momentum sleeve has fewer than 2 positions and retry is due or uninitialized, try to enter
    if (activeNonGrid.length < 2 && !this.breakerLatched && (this.momentumRetryAt === 0 || Date.now() >= this.momentumRetryAt)) {
      console.log(`[HybridLiveWorker] Momentum sleeve has ${activeNonGrid.length}/2 positions, checking for qualifying symbols...`);
      await this.retryMomentumEntry();
    }
    const accountEquity = parseFloat(account.totalMarginBalance || account.totalWalletBalance || '0');
    const availableBalance = parseFloat(account.availableBalance || '0');

    let totalUnrealizedPnl = 0.0;
    const posMap: HybridLiveState['positions'] = {};
    const alerts: Array<{ key: string; text: string }> = [];

    for (const p of activePositions) {
      const qty = parseFloat(p.positionAmt);
      const entry = parseFloat(p.entryPrice);
      const mark = parseFloat(p.markPrice || p.entryPrice);
      const unrl = (mark - entry) * qty;
      totalUnrealizedPnl += unrl;

      // Stop loss price: for Long position, entry * (1 - 0.12)
      const slPrice = qty > 0 ? entry * (1.0 - MOMENTUM_SL_PCT) : entry * (1.0 + MOMENTUM_SL_PCT);

      posMap[p.symbol] = {
        symbol: p.symbol,
        qty,
        entryPrice: entry,
        markPrice: mark,
        unrlPnl: unrl,
        slPrice,
      };

      // Ensure native STOP_MARKET order is on Binance matching engine
      if (!this.breakerLatched && qty > 0) {
        void this.syncNativeStopLoss(p.symbol, qty, slPrice);
      }

      // In-memory fallback check
      if (!this.breakerLatched && qty > 0 && mark <= slPrice) {
        console.warn(`[HybridLiveWorker] STOP LOSS TRIGGERED for ${p.symbol}: Mark=${mark} <= SL=${slPrice} (-${(MOMENTUM_SL_PCT * 100).toFixed(1)}%)! Closing position...`);
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
          console.log(`[HybridLiveWorker] STOP LOSS order submitted successfully for ${p.symbol}`);
          alerts.push({ key: `sl:${today}:${p.symbol}`, text: formatHybridStopNotice({ symbol: p.symbol, mark, slPrice, sent: true }) });
        } catch (err) {
          console.error(`[HybridLiveWorker] Failed to execute stop loss for ${p.symbol}:`, err);
          alerts.push({ key: `sl-fail:${today}:${p.symbol}`, text: formatHybridStopNotice({ symbol: p.symbol, mark, slPrice, sent: false }) });
        }
      }
    }

    const currentDayPnl = accountEquity - this.dayStartEquity;
    const dailyLossLimitUsd = this.compoundingManager.computeDailyLossLimit(this.dayStartEquity);

    // Check Daily Circuit Breaker (12% of dayStartEquity, floor 12.0 USDT)
    if (!this.breakerLatched && currentDayPnl <= -dailyLossLimitUsd) {
      console.error(`[HybridLiveWorker] CIRCUIT BREAKER TRIGGERED! Day PnL=${currentDayPnl.toFixed(2)} <= -${dailyLossLimitUsd.toFixed(2)} USDT. Flattening ALL positions!`);
      this.breakerLatched = true;
      let breakerOk = true;

      for (const p of activePositions) {
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
            console.log(`[HybridLiveWorker] Breaker flatten submitted for ${p.symbol}`);
          } catch (err) {
            breakerOk = false;
            console.error(`[HybridLiveWorker] Breaker flatten error for ${p.symbol}:`, err);
          }
        }
      }
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

    // Periodic dynamic universe refresh check (every 1200 ticks = ~1 hour)
    if (this.tickCounter % 1200 === 0) {
      const refreshRes = await this.dynamicUniverseScanner.refreshUniverse(false);
      if (refreshRes.refreshed) {
        console.log(`[HybridLiveWorker] Dynamic universe updated: ${refreshRes.symbols.length} symbols. Prefetching candles...`);
        await this.candleCache.prefetchAll(refreshRes.symbols);
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
      worstDayPnl: Math.min(currentDayPnl, 0),
      breakerLatched: this.breakerLatched,
      positions: posMap,
      btcGridLevels: this.btcGridLevels,
      lastRebalanceUtcDay: this.lastRebalanceUtcDay,
      daysSinceRebalance: this.daysSinceRebalance,
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
      },
      dynamicCompounding: {
        momentumAllocUsd: compoundingSnapshot.momentumAllocUsd,
        btcGridTicketUsd: compoundingSnapshot.btcGridTicketUsd,
        dailyLossLimitUsd: compoundingSnapshot.dailyLossLimitUsd,
        targetMomentumPct: MOMENTUM_ALLOC_PCT,
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
    };

    this.lastState = state;
    await fs.writeFile(path.join(this.stateDir, 'worker-status.json'), JSON.stringify(state, null, 2));
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
      for (const key of raw.keys ?? []) this.sentNotices.add(key);
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
      }),
    }, ...alerts];
    for (const job of jobs) {
      if (this.sentNotices.has(job.key)) continue;
      try {
        const ids = await sendHybridTelegram(job.text);
        if (!ids.length) return;
        this.sentNotices.add(job.key);
        await fs.writeFile(this.noticeFile(), JSON.stringify({ keys: [...this.sentNotices] }));
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

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SOURCE_MOMENTUM_SYMBOLS } from './market-data';

export const MIN_QUOTE_VOLUME_USD = 50_000_000; // $50M/24h liquidity threshold
export const DEFAULT_TOP_UNIVERSE_SIZE = 30; // Top 30 liquid momentum candidates
export const WEEKLY_REFRESH_INTERVAL_MS = 7 * 86_400_000; // Weekly refresh cycle

export const PEGGED_OR_STABLE_SYMBOLS = new Set([
  'USDCUSDT',
  'FDUSDUSDT',
  'TUSDUSDT',
  'BUSDUSDT',
  'EURUSDT',
  'DAIUSDT',
  'USDPUSDT',
  'AEURUSDT',
]);

export const DEFAULT_EXCLUDED_SYMBOLS = new Set([
  'BTCUSDT', // Reserved exclusively for BTC Mean-Reversion Grid sleeve
]);

export interface DynamicUniverseEntry {
  symbol: string;
  quoteVolume: number;
  priceChangePercent: number;
  lastPrice: number;
}

export interface DynamicUniverseState {
  lastUpdatedAt: string;
  lastUpdatedMs: number;
  totalCandidateCount: number;
  qualifyingCount: number;
  symbols: string[];
  entries: DynamicUniverseEntry[];
}

export interface DynamicUniverseScannerOptions {
  stateDir?: string;
  topN?: number;
  minVolumeUsd?: number;
  refreshIntervalMs?: number;
  fallbackUniverse?: readonly string[];
}

/**
 * DynamicUniverseScanner (Phase 4):
 * Dynamically screens the most liquid Binance Futures USDT contracts.
 * Concentrates capital on Top liquid market leaders (> $50M/day), minimizing taker slippage
 * and capturing explosive breakout alpha while eliminating survivorship bias.
 */
export class DynamicUniverseScanner {
  private stateDir: string;
  private topN: number;
  private minVolumeUsd: number;
  private refreshIntervalMs: number;
  private fallbackUniverse: readonly string[];
  private activeSymbols: string[] = [];
  private lastUpdatedMs = 0;
  private entries: DynamicUniverseEntry[] = [];
  private refreshing = false;

  constructor(options: DynamicUniverseScannerOptions = {}) {
    this.stateDir = options.stateDir || path.resolve(__dirname, '../../data/hybrid-live');
    this.topN = options.topN || DEFAULT_TOP_UNIVERSE_SIZE;
    this.minVolumeUsd = options.minVolumeUsd || MIN_QUOTE_VOLUME_USD;
    this.refreshIntervalMs = options.refreshIntervalMs || WEEKLY_REFRESH_INTERVAL_MS;
    this.fallbackUniverse = options.fallbackUniverse || SOURCE_MOMENTUM_SYMBOLS;
    // Default initial universe to fallback
    this.activeSymbols = [...this.fallbackUniverse];
  }

  public getUniverse(): string[] {
    return this.activeSymbols.length > 0 ? [...this.activeSymbols] : [...this.fallbackUniverse];
  }

  public getEntries(): DynamicUniverseEntry[] {
    return [...this.entries];
  }

  public getLastUpdatedMs(): number {
    return this.lastUpdatedMs;
  }

  public getState(): DynamicUniverseState {
    return {
      lastUpdatedAt: this.lastUpdatedMs > 0 ? new Date(this.lastUpdatedMs).toISOString() : 'never',
      lastUpdatedMs: this.lastUpdatedMs,
      totalCandidateCount: this.entries.length,
      qualifyingCount: this.activeSymbols.length,
      symbols: [...this.activeSymbols],
      entries: [...this.entries],
    };
  }

  /**
   * Scans Binance Futures 24hr ticker API.
   */
  public async scanFromBinanceApi(): Promise<DynamicUniverseEntry[]> {
    const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr', {
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      throw new Error(`Binance 24hr ticker API failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as Array<{
      symbol: string;
      quoteVolume: string;
      priceChangePercent: string;
      lastPrice: string;
    }>;

    if (!Array.isArray(data)) {
      throw new Error('Binance 24hr ticker API returned invalid non-array response');
    }

    const qualifying: DynamicUniverseEntry[] = [];

    for (const item of data) {
      const sym = item.symbol;
      if (!sym.endsWith('USDT')) continue;
      if (PEGGED_OR_STABLE_SYMBOLS.has(sym)) continue;
      if (DEFAULT_EXCLUDED_SYMBOLS.has(sym)) continue;

      const volume = parseFloat(item.quoteVolume || '0');
      if (volume < this.minVolumeUsd) continue;

      const pctChange = parseFloat(item.priceChangePercent || '0');
      const lastPx = parseFloat(item.lastPrice || '0');

      qualifying.push({
        symbol: sym,
        quoteVolume: volume,
        priceChangePercent: pctChange,
        lastPrice: lastPx,
      });
    }

    // Sort descending by 24h quote volume
    qualifying.sort((a, b) => b.quoteVolume - a.quoteVolume);
    return qualifying;
  }

  /**
   * Refreshes dynamic universe. Falls back to disk cache or hardcoded universe if API fails.
   */
  public async refreshUniverse(
    force = false
  ): Promise<{ symbols: string[]; refreshed: boolean; source: 'api' | 'cache' | 'fallback' }> {
    if (this.refreshing) {
      return { symbols: this.getUniverse(), refreshed: false, source: 'cache' };
    }

    const now = Date.now();
    if (!force && this.lastUpdatedMs > 0 && now - this.lastUpdatedMs < this.refreshIntervalMs) {
      return { symbols: this.getUniverse(), refreshed: false, source: 'cache' };
    }

    this.refreshing = true;
    const cacheFile = path.join(this.stateDir, 'dynamic-universe.json');

    try {
      // 1. Attempt live API scan
      console.log(`[DynamicUniverseScanner] Scanning Binance Futures for Top ${this.topN} symbols with 24h Vol >= $${(this.minVolumeUsd / 1e6).toFixed(0)}M...`);
      const candidates = await this.scanFromBinanceApi();

      if (candidates.length >= 10) {
        const topCandidates = candidates.slice(0, this.topN);
        this.entries = topCandidates;
        this.activeSymbols = topCandidates.map((c) => c.symbol);
        this.lastUpdatedMs = now;

        // Persist to disk cache
        try {
          await fs.mkdir(this.stateDir, { recursive: true });
          const payload: DynamicUniverseState = {
            lastUpdatedAt: new Date(now).toISOString(),
            lastUpdatedMs: now,
            totalCandidateCount: candidates.length,
            qualifyingCount: this.activeSymbols.length,
            symbols: this.activeSymbols,
            entries: this.entries,
          };
          await fs.writeFile(cacheFile, JSON.stringify(payload, null, 2), 'utf8');
        } catch (err) {
          console.warn('[DynamicUniverseScanner] Failed to persist disk cache:', err);
        }

        console.log(`[DynamicUniverseScanner] Successfully updated dynamic universe (${this.activeSymbols.length} symbols, Top 1: ${topCandidates[0]?.symbol} $${(topCandidates[0]?.quoteVolume / 1e6).toFixed(1)}M/d).`);
        return { symbols: this.getUniverse(), refreshed: true, source: 'api' };
      } else {
        console.warn(`[DynamicUniverseScanner] Binance API returned only ${candidates.length} candidates, insufficient.`);
      }
    } catch (err) {
      console.warn('[DynamicUniverseScanner] API scan failed, checking disk cache:', err instanceof Error ? err.message : err);
    } finally {
      this.refreshing = false;
    }

    // 2. Fallback to disk cache if available
    try {
      const raw = await fs.readFile(cacheFile, 'utf8');
      const cached = JSON.parse(raw) as DynamicUniverseState;
      if (Array.isArray(cached.symbols) && cached.symbols.length >= 10) {
        this.activeSymbols = cached.symbols;
        this.entries = cached.entries || [];
        this.lastUpdatedMs = cached.lastUpdatedMs || now;
        console.log(`[DynamicUniverseScanner] Restored ${this.activeSymbols.length} symbols from disk cache (${cached.lastUpdatedAt}).`);
        return { symbols: this.getUniverse(), refreshed: true, source: 'cache' };
      }
    } catch {
      // Disk cache missing or unparseable
    }

    // 3. Graceful fallback to verified SOURCE_MOMENTUM_SYMBOLS
    console.warn(`[DynamicUniverseScanner] Using fallback universe of ${this.fallbackUniverse.length} verified symbols.`);
    this.activeSymbols = [...this.fallbackUniverse];
    return { symbols: this.getUniverse(), refreshed: false, source: 'fallback' };
  }
}

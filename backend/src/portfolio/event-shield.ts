import { promises as fs } from 'node:fs';
import path from 'node:path';

export type EventShieldCategory =
  | 'DELISTING'
  | 'EXPLOIT_HACK'
  | 'REGULATORY_ENFORCEMENT'
  | 'MONITORING_TAG'
  | 'MANUAL_BLACKSWAN';

export type EventShieldSeverity = 'CRITICAL_CLOSE' | 'PREVENT_ENTRY';

export interface BlacklistEntry {
  symbol: string;
  reason: string;
  category: EventShieldCategory;
  severity: EventShieldSeverity;
  addedAt: string;
  source: string;
}

export interface EventShieldState {
  lastScannedAt: string;
  blacklistCount: number;
  criticalCloseCount: number;
  entries: Record<string, BlacklistEntry>;
}

export interface LLMEventShieldOptions {
  stateDir?: string;
  persistFile?: string;
  llmApiKey?: string;
}

/**
 * LLMEventShield (Phase 4):
 * Asynchronous Black Swan & Exploit Shield.
 * Protects quantitative capital by continuously scanning for delisting announcements,
 * smart contract exploits, and insolvency risks that mathematical momentum models are blind to.
 * 
 * - PREVENT_ENTRY: Blocks new momentum positions from being opened.
 * - CRITICAL_CLOSE: Triggers immediate emergency market exit for currently held positions.
 */
export class LLMEventShield {
  private stateDir: string;
  private persistPath: string;
  private entries = new Map<string, BlacklistEntry>();
  private lastScannedAt = '';

  constructor(options: LLMEventShieldOptions = {}) {
    this.stateDir = options.stateDir || path.resolve(__dirname, '../../data/hybrid-live');
    this.persistPath = options.persistFile || path.join(this.stateDir, 'shield-blacklist.json');
  }

  public async init(): Promise<void> {
    await this.loadFromDisk();
  }

  public isBlacklisted(symbol: string): boolean {
    const sym = symbol.toUpperCase().trim();
    return this.entries.has(sym);
  }

  public getSeverity(symbol: string): EventShieldSeverity | null {
    const sym = symbol.toUpperCase().trim();
    const entry = this.entries.get(sym);
    return entry ? entry.severity : null;
  }

  public getEntry(symbol: string): BlacklistEntry | null {
    const sym = symbol.toUpperCase().trim();
    return this.entries.get(sym) || null;
  }

  public getBlacklistedSymbols(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Returns symbols that have CRITICAL_CLOSE severity.
   * If any of these symbols are currently held in live positions, they must be closed immediately.
   */
  public getEmergencyCloseSymbols(): string[] {
    const result: string[] = [];
    for (const [sym, entry] of this.entries.entries()) {
      if (entry.severity === 'CRITICAL_CLOSE') {
        result.push(sym);
      }
    }
    return result;
  }

  public async addEntry(entry: BlacklistEntry): Promise<void> {
    const sym = entry.symbol.toUpperCase().trim();
    this.entries.set(sym, {
      ...entry,
      symbol: sym,
      addedAt: entry.addedAt || new Date().toISOString(),
    });
    console.log(
      `[LLMEventShield] Blacklisted ${sym}: [${entry.severity}] ${entry.category} - ${entry.reason} (Source: ${entry.source})`
    );
    await this.saveToDisk();
  }

  public async removeEntry(symbol: string): Promise<boolean> {
    const sym = symbol.toUpperCase().trim();
    const existed = this.entries.delete(sym);
    if (existed) {
      console.log(`[LLMEventShield] Removed ${sym} from blacklist.`);
      await this.saveToDisk();
    }
    return existed;
  }

  public getState(): EventShieldState {
    const entriesObj: Record<string, BlacklistEntry> = {};
    let criticalCount = 0;
    for (const [sym, entry] of this.entries.entries()) {
      entriesObj[sym] = entry;
      if (entry.severity === 'CRITICAL_CLOSE') criticalCount++;
    }

    return {
      lastScannedAt: this.lastScannedAt || new Date().toISOString(),
      blacklistCount: this.entries.size,
      criticalCloseCount: criticalCount,
      entries: entriesObj,
    };
  }

  /**
   * Deterministic High-Precision News & Security Classifier.
   * Matches official Binance announcements and crypto security feeds.
   */
  public classifyNews(headline: string, body = '', source = 'news_feed'): BlacklistEntry | null {
    const text = `${headline} ${body}`.toLowerCase();

    // 1. Delisting announcement
    const isDelist =
      /delist|delisting|cease trading|remove and cease|terminate.*trading|will be delisted/i.test(text);

    // 2. Hack / Exploit / Smart contract drain
    const isHack =
      /hack|hacked|exploit|drained|vulnerability|attacked|security.*breach|bridge exploit|smart contract compromise/i.test(
        text
      );

    // 3. Insolvency / Regulatory emergency freeze
    const isRegulatory =
      /sec.*charges|sec enforcement|freeze.*assets|insolvent|bankruptcy|chapter 11|criminal indictment|founder arrest/i.test(
        text
      );

    // 4. Monitoring / Seed tag (elevated risk)
    const isMonitoring = /monitoring tag|seed tag|elevated risk warning|high risk label/i.test(text);

    if (!isDelist && !isHack && !isRegulatory && !isMonitoring) {
      return null;
    }

    // Extract symbol candidate
    const symbol = this.extractSymbolFromText(headline, body);
    if (!symbol) return null;

    let category: EventShieldCategory = 'MONITORING_TAG';
    let severity: EventShieldSeverity = 'PREVENT_ENTRY';
    let reason = '';

    if (isDelist) {
      category = 'DELISTING';
      severity = 'CRITICAL_CLOSE';
      reason = `Binance announcement: Contract delisting or trading cessation`;
    } else if (isHack) {
      category = 'EXPLOIT_HACK';
      severity = 'CRITICAL_CLOSE';
      reason = `Security alert: Protocol exploit or smart contract compromise`;
    } else if (isRegulatory) {
      category = 'REGULATORY_ENFORCEMENT';
      severity = 'CRITICAL_CLOSE';
      reason = `Regulatory emergency: Enforcement action or insolvency`;
    } else if (isMonitoring) {
      category = 'MONITORING_TAG';
      severity = 'PREVENT_ENTRY';
      reason = `Exchange alert: Assigned monitoring/seed high-risk tag`;
    }

    return {
      symbol,
      reason: `${reason} ("${headline.slice(0, 100)}")`,
      category,
      severity,
      addedAt: new Date().toISOString(),
      source,
    };
  }

  /**
   * Extracts crypto symbol candidate from headline text.
   * Looks for USDT-pairs or capitalized coin tickers.
   */
  public extractSymbolFromText(headline: string, body = ''): string | null {
    const text = `${headline} ${body}`;

    // Priority 1: Direct USDT pair match (e.g. LUNAUSDT, FTTUSDT, WLDUSDT)
    const usdtMatch = text.match(/\b([A-Z0-9]{2,12})USDT\b/);
    if (usdtMatch) {
      return `${usdtMatch[1]}USDT`;
    }

    // Priority 2: Parenthesized ticker (e.g. "Terra (LUNA)", "Tornado Cash (TORN)")
    const parenMatch = text.match(/\(([A-Z0-9]{2,10})\)/);
    if (parenMatch && parenMatch[1] !== 'USDT' && parenMatch[1] !== 'USD') {
      return `${parenMatch[1]}USDT`;
    }

    // Priority 3: Standalone uppercase ticker preceded by words like "on", "for", "delist"
    const contextMatch = text.match(/\b(?:delist|support for|trading of|suspension of|exploit on)\s+([A-Z0-9]{2,10})\b/i);
    if (contextMatch && contextMatch[1].toUpperCase() !== 'THE' && contextMatch[1].toUpperCase() !== 'ALL') {
      return `${contextMatch[1].toUpperCase()}USDT`;
    }

    return null;
  }

  /**
   * Persists blacklist entries to disk.
   */
  public async saveToDisk(): Promise<void> {
    try {
      await fs.mkdir(this.stateDir, { recursive: true });
      const entriesArr = Array.from(this.entries.values());
      await fs.writeFile(this.persistPath, JSON.stringify(entriesArr, null, 2), 'utf8');
    } catch (err) {
      console.warn('[LLMEventShield] Failed to persist blacklist to disk:', err);
    }
  }

  /**
   * Loads blacklist entries from disk.
   */
  public async loadFromDisk(): Promise<void> {
    try {
      const raw = await fs.readFile(this.persistPath, 'utf8');
      const list = JSON.parse(raw) as BlacklistEntry[];
      if (Array.isArray(list)) {
        this.entries.clear();
        for (const item of list) {
          if (item.symbol) {
            this.entries.set(item.symbol.toUpperCase().trim(), item);
          }
        }
        console.log(`[LLMEventShield] Restored ${this.entries.size} blacklisted symbols from disk.`);
      }
    } catch {
      // File does not exist yet; safe to ignore
    }
  }
}

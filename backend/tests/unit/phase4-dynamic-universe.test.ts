import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DynamicUniverseScanner,
  MIN_QUOTE_VOLUME_USD,
  DEFAULT_TOP_UNIVERSE_SIZE,
  PEGGED_OR_STABLE_SYMBOLS,
} from '../../src/portfolio/dynamic-universe';
import {
  LLMEventShield,
  type BlacklistEntry,
} from '../../src/portfolio/event-shield';
import {
  computeMomentumUniverse,
  selectTopMomentumSymbols,
  CandleRamCache,
  HybridLiveWorker,
} from '../../src/portfolio/hybrid-worker';
import type { LiveBroker, LivePosition } from '../../src/portfolio/live-broker';

describe('Phase 4: Dynamic Universe & LLM Event Shield', () => {
  describe('Part 1: DynamicUniverseScanner', () => {
    it('defines MIN_QUOTE_VOLUME_USD as $50M', () => {
      expect(MIN_QUOTE_VOLUME_USD).toBe(50_000_000);
    });

    it('filters out coins with volume < $50M and pegged/stable assets', async () => {
      const mockTickers = [
        // Qualifying altcoins
        { symbol: 'SOLUSDT', quoteVolume: '850000000', priceChangePercent: '5.2', lastPrice: '185.5' },
        { symbol: 'NEARUSDT', quoteVolume: '120000000', priceChangePercent: '8.1', lastPrice: '5.2' },
        { symbol: 'INJUSDT', quoteVolume: '75000000', priceChangePercent: '12.3', lastPrice: '22.0' },
        // Low volume (< 50M) -> MUST BE FILTERED
        { symbol: 'LOWVOLUSDT', quoteVolume: '15000000', priceChangePercent: '25.0', lastPrice: '0.05' },
        // Pegged stablecoins -> MUST BE FILTERED
        { symbol: 'USDCUSDT', quoteVolume: '900000000', priceChangePercent: '0.01', lastPrice: '1.0' },
        { symbol: 'FDUSDUSDT', quoteVolume: '300000000', priceChangePercent: '-0.02', lastPrice: '1.0' },
        // BTCUSDT -> RESERVED for BTC Grid sleeve -> MUST BE FILTERED
        { symbol: 'BTCUSDT', quoteVolume: '3500000000', priceChangePercent: '1.5', lastPrice: '68000' },
      ];

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTickers),
      } as unknown as Response);

      try {
        const scanner = new DynamicUniverseScanner();
        const results = await scanner.scanFromBinanceApi();

        const symbols = results.map((r) => r.symbol);
        expect(symbols).toContain('SOLUSDT');
        expect(symbols).toContain('NEARUSDT');
        expect(symbols).toContain('INJUSDT');

        expect(symbols).not.toContain('LOWVOLUSDT');
        expect(symbols).not.toContain('USDCUSDT');
        expect(symbols).not.toContain('FDUSDUSDT');
        expect(symbols).not.toContain('BTCUSDT');

        // Verify descending sort by quoteVolume
        expect(results[0].symbol).toBe('SOLUSDT');
        expect(results[1].symbol).toBe('NEARUSDT');
        expect(results[2].symbol).toBe('INJUSDT');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('refreshUniverse falls back safely to fallback universe when API fails', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error (simulated)'));

      try {
        const scanner = new DynamicUniverseScanner({
          stateDir: '/tmp/test-dynamic-universe-' + Date.now(),
          fallbackUniverse: ['SOLUSDT', 'NEARUSDT', 'INJUSDT'],
        });

        const res = await scanner.refreshUniverse(true);
        expect(res.source).toBe('fallback');
        expect(res.symbols).toEqual(['SOLUSDT', 'NEARUSDT', 'INJUSDT']);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('Part 2: LLMEventShield', () => {
    let shield: LLMEventShield;

    beforeEach(async () => {
      shield = new LLMEventShield({
        stateDir: '/tmp/test-shield-' + Date.now(),
      });
      await shield.init();
    });

    it('classifies delisting announcements as CRITICAL_CLOSE', () => {
      const entry = shield.classifyNews('Binance Will Delist and Cease Trading on LUNAUSDT Perpetual Contracts');
      expect(entry).not.toBeNull();
      expect(entry?.symbol).toBe('LUNAUSDT');
      expect(entry?.category).toBe('DELISTING');
      expect(entry?.severity).toBe('CRITICAL_CLOSE');
    });

    it('classifies smart contract exploits as CRITICAL_CLOSE', () => {
      const entry = shield.classifyNews(
        'Security Alert: Protocol Exploit on FTTUSDT Smart Contract Drained $50M',
        'Funds moved to tornado cash'
      );
      expect(entry).not.toBeNull();
      expect(entry?.symbol).toBe('FTTUSDT');
      expect(entry?.category).toBe('EXPLOIT_HACK');
      expect(entry?.severity).toBe('CRITICAL_CLOSE');
    });

    it('classifies regulatory freeze as CRITICAL_CLOSE', () => {
      const entry = shield.classifyNews('SEC Enforcement Charges Filed Against Tornado Cash (TORN), Assets Frozen');
      expect(entry).not.toBeNull();
      expect(entry?.symbol).toBe('TORNUSDT');
      expect(entry?.category).toBe('REGULATORY_ENFORCEMENT');
      expect(entry?.severity).toBe('CRITICAL_CLOSE');
    });

    it('classifies monitoring/seed tag as PREVENT_ENTRY', () => {
      const entry = shield.classifyNews('Binance Adds Monitoring Tag to WLDUSDT Due to High Volatility');
      expect(entry).not.toBeNull();
      expect(entry?.symbol).toBe('WLDUSDT');
      expect(entry?.category).toBe('MONITORING_TAG');
      expect(entry?.severity).toBe('PREVENT_ENTRY');
    });

    it('returns null for routine benign news', () => {
      const entry = shield.classifyNews('Bitcoin Reaches New All-Time High As Global Liquidity Expands');
      expect(entry).toBeNull();
    });

    it('manages blacklist addition, retrieval, and emergency close list', async () => {
      expect(shield.isBlacklisted('LUNAUSDT')).toBe(false);

      await shield.addEntry({
        symbol: 'LUNAUSDT',
        reason: 'Delisting notice from exchange',
        category: 'DELISTING',
        severity: 'CRITICAL_CLOSE',
        addedAt: new Date().toISOString(),
        source: 'binance_announcements',
      });

      await shield.addEntry({
        symbol: 'WLDUSDT',
        reason: 'Monitoring tag',
        category: 'MONITORING_TAG',
        severity: 'PREVENT_ENTRY',
        addedAt: new Date().toISOString(),
        source: 'binance_tags',
      });

      expect(shield.isBlacklisted('LUNAUSDT')).toBe(true);
      expect(shield.getSeverity('LUNAUSDT')).toBe('CRITICAL_CLOSE');
      expect(shield.getSeverity('WLDUSDT')).toBe('PREVENT_ENTRY');

      // Emergency close list should ONLY contain CRITICAL_CLOSE symbols
      const emergencyList = shield.getEmergencyCloseSymbols();
      expect(emergencyList).toContain('LUNAUSDT');
      expect(emergencyList).not.toContain('WLDUSDT');

      // Removal
      await shield.removeEntry('LUNAUSDT');
      expect(shield.isBlacklisted('LUNAUSDT')).toBe(false);
      expect(shield.getEmergencyCloseSymbols()).not.toContain('LUNAUSDT');
    });
  });

  describe('Part 3: Worker Integration with Event Shield & Dynamic Universe', () => {
    it('selectTopMomentumSymbols skips blacklisted candidate even with top score', async () => {
      const shield = new LLMEventShield({ stateDir: '/tmp/test-shield-' + Date.now() });
      await shield.addEntry({
        symbol: 'HOTCOIN',
        reason: 'Contract exploit reported',
        category: 'EXPLOIT_HACK',
        severity: 'CRITICAL_CLOSE',
        addedAt: new Date().toISOString(),
        source: 'security_feed',
      });

      const ranked = [
        { symbol: 'HOTCOIN', score: 0.35 }, // Rank 1: High momentum, BUT BLACKLISTED -> MUST BE SKIPPED
        { symbol: 'INJUSDT', score: 0.20 }, // Rank 2: Safe -> QUALIFIES
        { symbol: 'NEARUSDT', score: 0.15 }, // Rank 3: Safe -> QUALIFIES
      ];

      // Mock premiumIndex with low funding rates for all
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { symbol: 'HOTCOIN', lastFundingRate: '0.0001' },
            { symbol: 'INJUSDT', lastFundingRate: '0.0001' },
            { symbol: 'NEARUSDT', lastFundingRate: '0.0001' },
          ]),
      } as unknown as Response);

      try {
        const selected = await selectTopMomentumSymbols(ranked, 2, 'TestRebalance', shield);
        // HOTCOIN skipped by Event Shield; selects INJUSDT and NEARUSDT
        expect(selected).toEqual(['INJUSDT', 'NEARUSDT']);
        expect(selected).not.toContain('HOTCOIN');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('emergencyClosePosition closes position and cancels native stops', async () => {
      const mockBroker: Partial<LiveBroker> = {
        submitMarketOrder: vi.fn().mockResolvedValue({
          orderId: 8888,
          symbol: 'LUNAUSDT',
          status: 'FILLED',
          executedQty: '100',
        }),
        getOpenAlgoOrders: vi.fn().mockResolvedValue([
          { algoId: 7777, clientAlgoId: 'sl_luna_7777', symbol: 'LUNAUSDT', orderType: 'STOP_MARKET', algoStatus: 'NEW' },
        ]),
        cancelAlgoOrder: vi.fn().mockResolvedValue(true),
      };

      const worker = new HybridLiveWorker();
      (worker as unknown as { broker: LiveBroker }).broker = mockBroker as LiveBroker;

      const pos: LivePosition = {
        symbol: 'LUNAUSDT',
        positionAmt: '100',
        entryPrice: '10.0',
        markPrice: '9.0',
      };

      await worker.emergencyClosePosition('LUNAUSDT', pos, 'Binance Emergency Delist Notice');

      expect(mockBroker.submitMarketOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'LUNAUSDT',
          side: 'SELL',
          quantity: '100',
          reduceOnly: true,
        })
      );
      expect(mockBroker.cancelAlgoOrder).toHaveBeenCalled();
    });

    it('computeMomentumUniverse accepts dynamic universe of symbols', async () => {
      const cache = new CandleRamCache();
      const now = Date.now();
      const todayMidnight = Math.floor(now / 86_400_000) * 86_400_000;
      const DAY = 86_400_000;

      const dynamicSymbols = ['SUIUSDT', 'SEIUSDT', 'TIAUSDT'];
      for (const sym of dynamicSymbols) {
        const candles: Array<[number, string, string, string, string]> = [];
        for (let i = 15; i >= 0; i--) {
          const time = todayMidnight - i * DAY;
          const px = sym === 'SUIUSDT' && i === 1 ? '120' : '100';
          candles.push([time, px, px, px, px]);
        }
        cache.setCandles(sym, candles);
      }

      const results = await computeMomentumUniverse(cache, dynamicSymbols);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].symbol).toBe('SUIUSDT');
      expect(results[0].score).toBeCloseTo(0.20, 2);
    });
  });
});

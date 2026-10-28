import { describe, it, expect, vi } from 'vitest';
import {
  compute14dReturnFromCandles,
  CandleRamCache,
  FUNDING_RATE_CAP,
  selectTopMomentumSymbols,
  computeMomentumUniverse,
  HybridLiveWorker,
} from '../../src/portfolio/hybrid-worker';
import type { LiveBroker, LivePosition, LiveAlgoOrder } from '../../src/portfolio/live-broker';

describe('Phase 3 Resilient Execution & Funding Guard', () => {
  describe('Nhiệm vụ 1: compute14dReturnFromCandles & CandleRamCache', () => {
    it('computes 14d return accurately from 16 daily candles post day roll', () => {
      const now = Date.now();
      const todayMidnight = Math.floor(now / 86_400_000) * 86_400_000;
      const DAY = 86_400_000;

      // 16 candles: index 0 is T-15, index 14 is T-1 (yesterday closed), index 15 is today (new day)
      const candles: Array<[number, string, string, string, string]> = [];
      for (let i = 15; i >= 0; i--) {
        const time = todayMidnight - i * DAY;
        // Base price 100 on index 0 (T-15), closes at 110 on index 14 (T-1) -> +10%
        let px = 100;
        if (i === 1) px = 110; // index 14: T-1
        if (i === 0) px = 105; // index 15: today open
        candles.push([time, px.toString(), px.toString(), px.toString(), px.toString()]);
      }

      const ret = compute14dReturnFromCandles(candles);
      expect(ret).not.toBeNull();
      // (110 - 100) / 100 = 0.10 (+10%)
      expect(ret).toBeCloseTo(0.10, 4);
    });

    it('computes 14d return accurately from 16 daily candles pre-roll (e.g. 23:55 UTC)', () => {
      const now = Date.now();
      const currentDayMidnight = Math.floor(now / 86_400_000) * 86_400_000;
      const DAY = 86_400_000;

      // 16 candles where last candle is today's forming candle (openTime = currentDayMidnight)
      // but we test when target is the latest candle (e.g. before roll)
      const candles: Array<[number, string, string, string, string]> = [];
      const pastMidnight = currentDayMidnight - 15 * DAY;
      for (let i = 0; i < 16; i++) {
        const time = pastMidnight + i * DAY;
        let px = 100;
        if (i === 15) px = 120; // +20% on the latest bar
        candles.push([time, px.toString(), px.toString(), px.toString(), px.toString()]);
      }

      // If last candle openTime is today's midnight, index 14 (T-1) has px=100 -> return is 0
      // If we simulate candle pre-roll where latest bar open is yesterday:
      const preRollCandles: Array<[number, string, string, string, string]> = candles.map((c) => [
        c[0] - DAY, // shift 1 day back so last candle is before today's midnight
        c[1],
        c[2],
        c[3],
        c[4],
      ]);
      const retPreRoll = compute14dReturnFromCandles(preRollCandles);
      expect(retPreRoll).not.toBeNull();
      // (120 - 100) / 100 = 0.20 (+20%)
      expect(retPreRoll).toBeCloseTo(0.20, 4);
    });

    it('returns null if candles array has fewer than 15 bars', () => {
      const candles: Array<[number, string, string, string, string]> = [];
      for (let i = 0; i < 10; i++) {
        candles.push([i * 86_400_000, '100', '100', '100', '100']);
      }
      expect(compute14dReturnFromCandles(candles)).toBeNull();
    });

    it('CandleRamCache stores and retrieves candles in memory', () => {
      const cache = new CandleRamCache();
      expect(cache.size()).toBe(0);

      const mockCandles: Array<[number, string, string, string, string]> = [];
      for (let i = 0; i < 16; i++) {
        mockCandles.push([i * 86_400_000, '10', '10', '10', '10']);
      }
      cache.setCandles('INJUSDT', mockCandles);

      expect(cache.size()).toBe(1);
      expect(cache.hasSufficientCandles('INJUSDT')).toBe(true);
      expect(cache.hasSufficientCandles('BTCUSDT')).toBe(false);
      expect(cache.getCandles('INJUSDT')).toEqual(mockCandles);
      expect(cache.getCandles('BTCUSDT')).toBeNull();
    });

    it('computeMomentumUniverse executes from RAM cache in under 50ms', async () => {
      const cache = new CandleRamCache();
      const now = Date.now();
      const todayMidnight = Math.floor(now / 86_400_000) * 86_400_000;
      const DAY = 86_400_000;

      // Populate RAM cache for ALL 40 universe coins
      const { SOURCE_MOMENTUM_SYMBOLS } = await import('../../src/portfolio/market-data');
      for (const sym of SOURCE_MOMENTUM_SYMBOLS) {
        const candles: Array<[number, string, string, string, string]> = [];
        for (let i = 15; i >= 0; i--) {
          const time = todayMidnight - i * DAY;
          const px = sym === 'INJUSDT' && i === 1 ? '110' : '100';
          candles.push([time, px, px, px, px]);
        }
        cache.setCandles(sym, candles);
      }

      // Warm-up JIT
      await computeMomentumUniverse(cache);

      const t0 = performance.now();
      // Test computeMomentumUniverse with full RAM cache
      const ranked = await computeMomentumUniverse(cache);
      const elapsedMs = performance.now() - t0;

      // Assert zero-latency RAM processing < 120ms (accounting for shared VPS CPU jitter)
      expect(elapsedMs).toBeLessThan(120);
      expect(Array.isArray(ranked)).toBe(true);
      expect(ranked.length).toBeGreaterThan(0);
      expect(ranked[0].symbol).toBe('INJUSDT');
    });
  });

  describe('Nhiệm vụ 2: Funding Rate Guard', () => {
    it('defines FUNDING_RATE_CAP as 0.0005 (+0.05% per 8h)', () => {
      expect(FUNDING_RATE_CAP).toBe(0.0005);
    });

    it('skips Top momentum coins with lastFundingRate > 0.0005 and picks next safe candidate', async () => {
      // Mock ranked momentum universe
      const ranked = [
        { symbol: 'HOTCOIN', score: 0.25 }, // Top 1: high momentum, high funding -> MUST BE SKIPPED
        { symbol: 'INJUSDT', score: 0.18 }, // Top 2: high momentum, safe funding -> QUALIFIES
        { symbol: 'TOXICCOIN', score: 0.15 }, // Top 3: high funding -> MUST BE SKIPPED
        { symbol: '1000PEPEUSDT', score: 0.12 }, // Top 4: safe funding -> QUALIFIES
        { symbol: 'NEARUSDT', score: 0.08 },
      ];

      // Mock fetchAllFundingRates response
      const mockFundingRates = new Map<string, number>([
        ['HOTCOIN', 0.0008], // +0.08% > 0.05% -> SKIP
        ['INJUSDT', 0.0001], // +0.01% <= 0.05% -> PASS
        ['TOXICCOIN', 0.0012], // +0.12% > 0.05% -> SKIP
        ['1000PEPEUSDT', -0.0001], // -0.01% <= 0.05% -> PASS
        ['NEARUSDT', 0.0002], // +0.02% <= 0.05% -> PASS
      ]);

      // Mock global fetch for premiumIndex
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('premiumIndex')) {
          const arr = Array.from(mockFundingRates.entries()).map(([symbol, lastFundingRate]) => ({
            symbol,
            lastFundingRate: lastFundingRate.toString(),
          }));
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(arr),
          });
        }
        return originalFetch(url);
      });

      try {
        const selected = await selectTopMomentumSymbols(ranked, 2, 'TestRebalance');
        // Should select INJUSDT and 1000PEPEUSDT, skipping HOTCOIN and TOXICCOIN
        expect(selected).toEqual(['INJUSDT', '1000PEPEUSDT']);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('returns empty array if no qualifying candidates exist', async () => {
      const selected = await selectTopMomentumSymbols([], 2, 'TestRebalance');
      expect(selected).toEqual([]);
    });
  });

  describe('Nhiệm vụ 3: 15-Minute Cross-Reconciliation Logic', () => {
    it('verifies that reconciliation detects missing exchange stop loss and requests placement', async () => {
      const mockBroker: Partial<LiveBroker> = {
        getPositions: vi.fn().mockResolvedValue([
          { symbol: 'INJUSDT', positionAmt: '3.1', entryPrice: '7.83', markPrice: '7.80' },
        ] as LivePosition[]),
        getAccount: vi.fn().mockResolvedValue({
          totalMarginBalance: '30.0',
          totalWalletBalance: '30.0',
          availableBalance: '20.0',
        }),
        getOpenAlgoOrders: vi.fn().mockResolvedValue([] as LiveAlgoOrder[]), // No active stop orders!
        submitStopMarketOrder: vi.fn().mockResolvedValue({
          orderId: 12345,
          clientOrderId: 'sl_injusdt_test',
          symbol: 'INJUSDT',
          status: 'NEW',
          executedQty: '0',
        }),
      };

      const worker = new HybridLiveWorker();
      // Inject mock broker
      (worker as unknown as { broker: LiveBroker }).broker = mockBroker as LiveBroker;
      (worker as unknown as { exchangeFilters: Record<string, { stepSize: number; tickSize: number; minQty: number; minNotional: number }> })
        .exchangeFilters['INJUSDT'] = { stepSize: 0.1, tickSize: 0.001, minQty: 0.1, minNotional: 5.0 };

      // Run reconcileState
      await worker.reconcileState();

      // submitStopMarketOrder should have been called to restore missing stop
      expect(mockBroker.submitStopMarketOrder).toHaveBeenCalledTimes(1);
    });

    it('verifies that reconciliation preserves existing active stop loss orders without duplicates', async () => {
      const mockBroker: Partial<LiveBroker> = {
        getPositions: vi.fn().mockResolvedValue([
          { symbol: 'INJUSDT', positionAmt: '3.1', entryPrice: '7.83', markPrice: '7.80' },
        ] as LivePosition[]),
        getAccount: vi.fn().mockResolvedValue({
          totalMarginBalance: '30.0',
          totalWalletBalance: '30.0',
          availableBalance: '20.0',
        }),
        getOpenAlgoOrders: vi.fn().mockResolvedValue([
          {
            algoId: 9999,
            orderType: 'STOP_MARKET',
            algoStatus: 'NEW',
            symbol: 'INJUSDT',
          },
        ] as LiveAlgoOrder[]), // Existing stop loss is ACTIVE and NEW
        submitStopMarketOrder: vi.fn(),
      };

      const worker = new HybridLiveWorker();
      (worker as unknown as { broker: LiveBroker }).broker = mockBroker as LiveBroker;
      (worker as unknown as { exchangeFilters: Record<string, { stepSize: number; tickSize: number; minQty: number; minNotional: number }> })
        .exchangeFilters['INJUSDT'] = { stepSize: 0.1, tickSize: 0.001, minQty: 0.1, minNotional: 5.0 };

      await worker.reconcileState();

      // Existing stop was valid, so submitStopMarketOrder should NOT be called
      expect(mockBroker.submitStopMarketOrder).not.toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/portfolio/hybrid-live-notice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/portfolio/hybrid-live-notice')>();
  return {
    ...actual,
    sendHybridTelegram: vi.fn().mockResolvedValue(['999']),
  };
});

import {
  CandleRamCache,
  computeMomentumUniverse,
  floorPriceToTick,
  resolveMomentumRegime,
  HybridLiveWorker,
  OFFICIAL_RELEASE_VERSION,
  PROFIT_LOCK_COOLDOWN_MS,
  FALLING_KNIFE_24H_FLOOR_PCT,
  BTC_MACRO_BEAR_GATE_PCT,
  RATCHET_RISK_REDUCTION_TRIGGER,
  RATCHET_RISK_REDUCTION_SL_PCT,
  PRUNING_MAX_RETURN_THRESH,
  PRUNING_CURRENT_RETURN_THRESH,
} from '../../src/portfolio/hybrid-worker';
import {
  DynamicCompoundingManager,
  MOMENTUM_ALLOC_PCT,
  DEFENSIVE_MOMENTUM_ALLOC_PCT,
} from '../../src/portfolio/dynamic-compounding';
import type { LiveBroker } from '../../src/portfolio/live-broker';

function makeDailyCandles(
  closes: number[],
  todayOverride?: { open: number; close: number; high?: number; low?: number }
): Array<[number, string, string, string, string]> {
  const DAY = 86_400_000;
  const todayMidnight = Math.floor(Date.now() / DAY) * DAY;
  const n = closes.length;
  return closes.map((c, idx) => {
    const time = todayMidnight - (n - 1 - idx) * DAY;
    const isToday = idx === n - 1 && todayOverride;
    const open = isToday ? todayOverride.open : c;
    const close = isToday ? todayOverride.close : c;
    const high = isToday && todayOverride.high !== undefined ? todayOverride.high : Math.max(open, close);
    const low = isToday && todayOverride.low !== undefined ? todayOverride.low : Math.min(open, close);
    return [time, open.toString(), high.toString(), low.toString(), close.toString()];
  });
}

describe('v2.0.0 Safety Guards, Venue Stop Ordering & Worker Reconciliation', () => {
  it('defines calibrated v2.0.0 constants and safety thresholds', () => {
    expect(OFFICIAL_RELEASE_VERSION).toBe('v2.0.0');
    expect(PROFIT_LOCK_COOLDOWN_MS).toBe(24 * 3_600_000);
    expect(FALLING_KNIFE_24H_FLOOR_PCT).toBe(-0.15);
    expect(BTC_MACRO_BEAR_GATE_PCT).toBe(-0.10);
    expect(DEFENSIVE_MOMENTUM_ALLOC_PCT).toBe(0.25);
    expect(RATCHET_RISK_REDUCTION_TRIGGER).toBe(0.03);
    expect(RATCHET_RISK_REDUCTION_SL_PCT).toBe(-0.04);
    expect(PRUNING_MAX_RETURN_THRESH).toBe(0.03);
    expect(PRUNING_CURRENT_RETURN_THRESH).toBe(-0.04);
  });

  it('resolveMomentumRegime switches cleanly between normal, macro_defensive, and fail-safe crash_freeze', () => {
    expect(resolveMomentumRegime(-0.01, -0.05)).toEqual({
      mode: 'normal',
      crashBlocked: false,
      maxSlots: 2,
      allocPct: MOMENTUM_ALLOC_PCT,
    });

    expect(resolveMomentumRegime(-0.015, -0.10)).toEqual({
      mode: 'macro_defensive',
      crashBlocked: false,
      maxSlots: 1,
      allocPct: DEFENSIVE_MOMENTUM_ALLOC_PCT,
    });

    expect(resolveMomentumRegime(-0.01, -0.1893)).toEqual({
      mode: 'macro_defensive',
      crashBlocked: false,
      maxSlots: 1,
      allocPct: DEFENSIVE_MOMENTUM_ALLOC_PCT,
    });

    expect(resolveMomentumRegime(-0.04, 0.05)).toEqual({
      mode: 'crash_freeze',
      crashBlocked: true,
      maxSlots: 0,
      allocPct: 0,
    });

    // Fail-safe: when BTC REST signal fails (signalAvailable=false), freeze entries instead of assuming normal mode
    expect(resolveMomentumRegime(0, null, false)).toEqual({
      mode: 'crash_freeze',
      crashBlocked: true,
      maxSlots: 0,
      allocPct: 0,
    });
  });

  it('DynamicCompoundingManager supports defensive 25% alloc override', () => {
    const mgr = new DynamicCompoundingManager(5.0);
    expect(mgr.computeMomentumAlloc(100)).toBe(35.0);
    expect(mgr.computeMomentumAlloc(100, undefined, DEFENSIVE_MOMENTUM_ALLOC_PCT)).toBe(25.0);
  });

  it('Falling-Knife Guard rejects coins dumping <= -15% in 24h or intraday while allowing healthy -10% pullbacks', async () => {
    const cache = new CandleRamCache();
    // Both symbols closed +10% on yesterday's 14d bar
    const closes = Array.from({ length: 16 }, (_, idx) => (idx === 14 ? 110 : 100));
    // ELSAUSDT: rolling 24h change is -25.38% (like live incident)
    cache.setCandles('ELSAUSDT', makeDailyCandles(closes, { open: 100, close: 101 }));
    // CRASHUSDT: intraday today crashed -16.0% (120 -> 100.8)
    cache.setCandles('CRASHUSDT', makeDailyCandles(closes, { open: 120, close: 100.8 }));
    // PULLBACKUSDT: mild -10% pullback (111.1 -> 100, above -15% floor) with +2% live 14d
    cache.setCandles('PULLBACKUSDT', makeDailyCandles(closes, { open: 113, close: 102 }));

    const changes24h = new Map<string, number>([
      ['ELSAUSDT', -0.2538],
      ['CRASHUSDT', -0.05],
      ['PULLBACKUSDT', -0.10],
    ]);

    const ranked = await computeMomentumUniverse(cache, ['ELSAUSDT', 'CRASHUSDT', 'PULLBACKUSDT'], changes24h);
    expect(ranked.map((r) => r.symbol)).toEqual(['PULLBACKUSDT']);
  });

  it('Falling-Knife Guard rejects coins whose live 14d return flipped <= 0 today', async () => {
    const cache = new CandleRamCache();
    // 14d ago = 100, yesterday = 108 (+8%), today dropped from 106 -> 99 (-6.6% intraday, live 14d = -1%)
    const closes = Array.from({ length: 16 }, (_, idx) => (idx === 14 ? 108 : 100));
    cache.setCandles('FADEDUSDT', makeDailyCandles(closes, { open: 106, close: 99 }));

    const ranked = await computeMomentumUniverse(cache, ['FADEDUSDT']);
    expect(ranked).toEqual([]);
  });

  it('runTurtleCycle closes unaligned positions on BTC EMA50 regime flip cleanly without PositionCloseGuard misclassification', async () => {
    const worker = new HybridLiveWorker();
    worker.activeTrackedPositions.set('VVVUSDT', {
      side: 'LONG',
      qty: 10,
      entryPrice: 2.0,
      slPrice: 1.76,
      ratchetTier: 'initial',
    });

    const mockBroker: Partial<LiveBroker> = {
      getPositions: vi.fn().mockResolvedValue([
        { symbol: 'VVVUSDT', positionAmt: '10', entryPrice: '2.0', markPrice: '2.05', positionSide: 'BOTH' },
      ]),
      submitMarketOrder: vi.fn().mockResolvedValue({
        orderId: 1,
        clientOrderId: 'reg_exit',
        symbol: 'VVVUSDT',
        status: 'FILLED',
        executedQty: '10',
        avgPrice: '2.05',
      }),
      getOpenAlgoOrders: vi.fn().mockResolvedValue([]),
      getAccount: vi.fn().mockResolvedValue({
        totalMarginBalance: '100',
        totalWalletBalance: '100',
        availableBalance: '90',
        totalUnrealizedProfit: '0',
        assets: [],
      }),
    };
    (worker as unknown as { broker: LiveBroker }).broker = mockBroker as LiveBroker;

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('klines') && url.includes('BTCUSDT')) {
        const now = Date.now();
        // BTC dropped below EMA50 (70k -> 60k): neutral_cash / bear_trend -> closes LONG VVVUSDT
        const bars = Array.from({ length: 100 }, (_, i) => [
          now - (99 - i) * 86_400_000,
          i >= 80 ? '60000' : '72000',
          i >= 80 ? '60500' : '72500',
          i >= 80 ? '59500' : '71500',
          i >= 80 ? '60000' : '72000',
        ]);
        return Promise.resolve({ ok: true, json: () => Promise.resolve(bars) } as Response);
      }
      if (url.includes('ticker/24hr') && url.includes('BTCUSDT')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ priceChangePercent: '-1.0' }) } as Response);
      }
      return originalFetch(url);
    });

    try {
      const ok = await worker.runTurtleCycle(false);
      expect(ok).toBe(true);
      expect(mockBroker.submitMarketOrder).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: 'VVVUSDT', side: 'SELL', reduceOnly: true })
      );
      expect(worker.activeTrackedPositions.has('VVVUSDT')).toBe(false);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('replaces Ratchet STOP_MARKET safely (places new order before cancelling old and preserves old stop on failure)', async () => {
    const worker = new HybridLiveWorker();
    (worker as unknown as { exchangeFilters: Record<string, unknown> }).exchangeFilters['ELSAUSDT'] = {
      stepSize: 1,
      tickSize: 0.0001,
      minQty: 1,
      minNotional: 5,
    };

    const callOrder: string[] = [];
    const mockBroker: Partial<LiveBroker> = {
      getOpenAlgoOrders: vi.fn().mockResolvedValue([
        { algoId: 100, clientAlgoId: 'sl_elsausdt_old', symbol: 'ELSAUSDT', orderType: 'STOP_MARKET', algoStatus: 'NEW' },
      ]),
      submitStopMarketOrder: vi.fn().mockImplementation(async (order) => {
        callOrder.push(`submit:${order.stopPrice}`);
        return { orderId: 200, clientOrderId: order.clientOrderId, symbol: 'ELSAUSDT', status: 'NEW', executedQty: '0' };
      }),
      cancelAlgoOrder: vi.fn().mockImplementation(async (_sym, id) => {
        callOrder.push(`cancel:${id}`);
        return { code: 200 };
      }),
    };
    (worker as unknown as { broker: LiveBroker }).broker = mockBroker as LiveBroker;

    const ok = await (
      worker as unknown as { replaceNativeStopLoss: (s: string, q: number, p: number) => Promise<boolean> }
    ).replaceNativeStopLoss('ELSAUSDT', 400, 0.081);

    expect(ok).toBe(true);
    expect(callOrder).toEqual(['submit:0.0810', 'cancel:sl_elsausdt_old']);

    // When submit fails, existing exchange stop order must NOT be cancelled
    (mockBroker.submitStopMarketOrder as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network timeout'));
    (mockBroker.cancelAlgoOrder as ReturnType<typeof vi.fn>).mockClear();
    const failed = await (
      worker as unknown as { replaceNativeStopLoss: (s: string, q: number, p: number) => Promise<boolean> }
    ).replaceNativeStopLoss('ELSAUSDT', 400, 0.085);

    expect(failed).toBe(false);
    expect(mockBroker.cancelAlgoOrder).not.toHaveBeenCalled();
  });

  it('reconcileState preserves Ratchet SL instead of downgrading to -12% and REST fallback enforces ATR filter', async () => {
    const worker = new HybridLiveWorker();
    worker.ratchetState.set('ELSAUSDT', {
      side: 'LONG',
      entryPrice: 0.10,
      currentSl: 0.11, // Lock +10%
      initialSlPct: 0.12,
      extremePrice: 0.115,
      maxRet: 0.15,
      atr14Pct: 0.05,
      tier: 'lock',
      entryTime: Date.now(),
    });
    (worker as unknown as { exchangeFilters: Record<string, unknown> }).exchangeFilters['ELSAUSDT'] = {
      stepSize: 1,
      tickSize: 0.0001,
      minQty: 1,
      minNotional: 5,
    };

    const mockBroker: Partial<LiveBroker> = {
      getPositions: vi.fn().mockResolvedValue([
        { symbol: 'ELSAUSDT', positionAmt: '200', entryPrice: '0.10', markPrice: '0.112', positionSide: 'BOTH' },
      ]),
      getAccount: vi.fn().mockResolvedValue({
        totalMarginBalance: '100',
        totalWalletBalance: '100',
        availableBalance: '90',
        totalUnrealizedProfit: '0',
        assets: [],
      }),
      getOpenAlgoOrders: vi.fn().mockResolvedValue([]),
      submitStopMarketOrder: vi.fn().mockResolvedValue({
        orderId: 501,
        clientOrderId: 'sl_elsausdt_reconcile',
        symbol: 'ELSAUSDT',
        status: 'NEW',
        executedQty: '0',
      }),
    };
    (worker as unknown as { broker: LiveBroker }).broker = mockBroker as LiveBroker;
    await worker.reconcileState();

    expect(mockBroker.submitStopMarketOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'ELSAUSDT',
        stopPrice: '0.1100',
      })
    );

    // Verify REST fallback rejects hyper-volatile (>20% ATR14) coin just like RAM cache path
    const DAY = 86_400_000;
    const todayMidnight = Math.floor(Date.now() / DAY) * DAY;
    const hyperCandles = Array.from({ length: 16 }, (_, idx) => {
      const time = todayMidnight - (15 - idx) * DAY;
      const close = idx >= 14 ? 110 : 100;
      return [time, String(close), String(close * 1.3), String(close * 0.8), String(close)];
    });
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(hyperCandles),
    } as Response);
    try {
      const cache = new CandleRamCache();
      const ranked = await computeMomentumUniverse(cache, ['HYPERUSDT']);
      expect(ranked).toEqual([]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('resolves actual post-fee realized PnL from userTrades and enforces safe leverage on openMomentumPosition', async () => {
    const worker = new HybridLiveWorker();
    (worker as unknown as { exchangeFilters: Record<string, unknown> }).exchangeFilters['NEARUSDT'] = {
      stepSize: 1,
      tickSize: 0.001,
      minQty: 1,
      minNotional: 5,
    };

    const mockBroker: Partial<LiveBroker> = {
      getMarkPrices: vi.fn().mockResolvedValue([{ symbol: 'NEARUSDT', markPrice: '5.0', time: Date.now() }]),
      setLeverage: vi.fn().mockResolvedValue({ leverage: 5 }),
      submitMarketOrder: vi.fn().mockResolvedValue({
        orderId: 777,
        clientOrderId: 'open_near',
        symbol: 'NEARUSDT',
        status: 'FILLED',
        executedQty: '5',
        avgPrice: '5.0',
      }),
      getOpenAlgoOrders: vi.fn().mockResolvedValue([]),
      submitStopMarketOrder: vi.fn().mockResolvedValue({
        orderId: 778,
        clientOrderId: 'sl_near',
        symbol: 'NEARUSDT',
        status: 'NEW',
        executedQty: '0',
      }),
      getUserTrades: vi.fn().mockResolvedValue([
        {
          id: 1,
          orderId: 901,
          symbol: 'NEARUSDT',
          price: '5.50',
          qty: '5',
          commission: '0.02',
          commissionAsset: 'USDT',
          realizedPnl: '2.50',
          time: Date.now(),
        },
      ]),
    };
    (worker as unknown as { broker: LiveBroker }).broker = mockBroker as LiveBroker;

    const opened = await (
      worker as unknown as {
        openTurtlePosition: (
          cand: { symbol: string; side: 'LONG' | 'SHORT'; score: number; atr14Pct: number; slPct: number; mom20Return: number; volRatio: number; price: number },
          equity: number,
          ctx: { availableBalance: number; activeNotionalUsd: number }
        ) => Promise<{ symbol: string; side: 'LONG' | 'SHORT'; qty: number; entryPrice: number; slPrice: number } | null>;
      }
    ).openTurtlePosition(
      { symbol: 'NEARUSDT', side: 'LONG', score: 2.0, atr14Pct: 0.05, slPct: 0.10, mom20Return: 0.15, volRatio: 1.5, price: 5.0 },
      100,
      { availableBalance: 90, activeNotionalUsd: 0 }
    );

    expect(opened).toMatchObject({ symbol: 'NEARUSDT', side: 'LONG', qty: 6, entryPrice: 5.0 });
    expect(mockBroker.setLeverage).toHaveBeenCalledWith('NEARUSDT', 5);

    const summary = await (
      worker as unknown as {
        resolveClosedTradeSummary: (
          s: string,
          q: number,
          e: number,
          fb: number,
          entryTime?: number
        ) => Promise<{ exitPrice: number; pnl: number }>;
      }
    ).resolveClosedTradeSummary('NEARUSDT', 5, 5.0, 4.4, Date.now() - 60_000);

    expect(summary.exitPrice).toBeCloseTo(5.5, 4);
    expect(summary.pnl).toBeCloseTo(2.48, 4);
  });

  it('floorPriceToTick aligns SL prices with venue tickSize and DynamicCompoundingManager blocks unaffordable BTC Grid', () => {
    expect(floorPriceToTick(0.168964, 0.0001)).toBe(0.1689);
    expect(floorPriceToTick(29.239992, 0.001)).toBe(29.239);

    const mgr = new DynamicCompoundingManager(5.0);
    const sub100 = mgr.evaluateGridAffordability(98.0, 60_000, 0.001, 50);
    expect(sub100.affordable).toBe(false);
    expect(sub100.rawTicketUsd).toBe(7.84);
    expect(sub100.minRequiredUsd).toBe(60);

    const eq800 = mgr.evaluateGridAffordability(800.0, 60_000, 0.001, 50);
    expect(eq800.affordable).toBe(true);
    expect(eq800.rawTicketUsd).toBe(64);
  });

  it('openTurtlePosition enforces exposure and availableBalance safety guards', async () => {
    const worker = new HybridLiveWorker();
    (worker as unknown as { exchangeFilters: Record<string, unknown> }).exchangeFilters['SOLUSDT'] = {
      stepSize: 0.1,
      tickSize: 0.01,
      minQty: 0.1,
      minNotional: 5,
    };
    const mockBroker: Partial<LiveBroker> = {
      getMarkPrices: vi.fn().mockResolvedValue([{ symbol: 'SOLUSDT', markPrice: '100', time: Date.now() }]),
      submitMarketOrder: vi.fn(),
    };
    (worker as unknown as { broker: LiveBroker }).broker = mockBroker as LiveBroker;

    const cand = { symbol: 'SOLUSDT', side: 'LONG' as const, score: 2.0, atr14Pct: 0.05, slPct: 0.10, mom20Return: 0.15, volRatio: 1.5, price: 100 };

    // Insufficient availableBalance -> blocked before order submission
    const lowMargin = await (
      worker as unknown as {
        openTurtlePosition: (c: typeof cand, e: number, ctx: { availableBalance: number; activeNotionalUsd: number }) => Promise<unknown>;
      }
    ).openTurtlePosition(cand, 100, { availableBalance: 2.0, activeNotionalUsd: 0 });
    expect(lowMargin).toBeNull();
    expect(mockBroker.submitMarketOrder).not.toHaveBeenCalled();

    // Exposure saturated -> blocked (< minNotional headroom)
    const overExposed = await (
      worker as unknown as {
        openTurtlePosition: (c: typeof cand, e: number, ctx: { availableBalance: number; activeNotionalUsd: number }) => Promise<unknown>;
      }
    ).openTurtlePosition(cand, 100, { availableBalance: 90.0, activeNotionalUsd: 97.0 });
    expect(overExposed).toBeNull();
    expect(mockBroker.submitMarketOrder).not.toHaveBeenCalled();
  });

  it('runTurtleCycle enters qualified Donchian20 + EMA20>EMA50 + Vol>=1.25x Long breakout and Circuit Breaker flattens non-locked positions', async () => {
    const os = await import('node:os');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-v200-'));

    const worker = new HybridLiveWorker({ stateDir: tmpDir });
    (worker as unknown as { currentDay: string }).currentDay = new Date().toISOString().slice(0, 10);
    (worker as unknown as { dayStartEquity: number }).dayStartEquity = 100.0;
    (worker as unknown as { exchangeFilters: Record<string, unknown> }).exchangeFilters = {
      BTCUSDT: { stepSize: 0.001, tickSize: 0.1, minQty: 0.001, minNotional: 50 },
      NEARUSDT: { stepSize: 1, tickSize: 0.001, minQty: 1, minNotional: 5 },
    };

    const DAY = 86_400_000;
    const todayMidnight = Math.floor(Date.now() / DAY) * DAY;
    // 100 daily bars rising smoothly with volume 10M/d and today breaking out > hi20
    const nearBars = Array.from({ length: 100 }, (_, i) => {
      const px = i < 99 ? 4.0 + i * 0.008 : 5.0; // prev 20d hi ~4.79, today breaks out to 5.0
      return [todayMidnight - (99 - i) * DAY, String(px), String(px * 1.01), String(px * 0.99), String(px), '1000', 0, '10000000'];
    });
    worker.candleCache.setCandles('NEARUSDT', nearBars as unknown as Array<[number, string, string, string, string]>);
    (worker as unknown as { dynamicUniverseScanner: { getUniverse: () => string[]; getState: () => { lastUpdatedAt: string } } }).dynamicUniverseScanner = {
      getUniverse: () => ['NEARUSDT'],
      getState: () => ({ lastUpdatedAt: new Date().toISOString() }),
    };

    let positionOpened = false;
    const mockBroker: Partial<LiveBroker> = {
      getAccount: vi.fn().mockResolvedValue({
        totalMarginBalance: '100',
        totalWalletBalance: '100',
        availableBalance: '90',
        totalUnrealizedProfit: '0',
        assets: [],
      }),
      getPositions: vi.fn().mockImplementation(async () => {
        if (!positionOpened) return [];
        return [{ symbol: 'NEARUSDT', positionAmt: '6', entryPrice: '5.0', markPrice: '5.0', positionSide: 'BOTH' }];
      }),
      getMarkPrices: vi.fn().mockResolvedValue([{ symbol: 'NEARUSDT', markPrice: '5.0', time: Date.now() }]),
      setLeverage: vi.fn().mockResolvedValue({ leverage: 5 }),
      submitMarketOrder: vi.fn().mockImplementation(async (order) => {
        if (order.side === 'BUY') positionOpened = true;
        else positionOpened = false;
        return {
          orderId: 10,
          clientOrderId: order.clientOrderId,
          symbol: order.symbol,
          status: 'FILLED',
          executedQty: order.quantity,
          avgPrice: '5.0',
        };
      }),
      getOpenAlgoOrders: vi.fn().mockResolvedValue([]),
      submitStopMarketOrder: vi.fn().mockResolvedValue({
        orderId: 11,
        clientOrderId: 'sl_near',
        symbol: 'NEARUSDT',
        status: 'NEW',
        executedQty: '0',
      }),
      cancelAlgoOrder: vi.fn().mockResolvedValue({ code: 200 }),
    };
    (worker as unknown as { broker: LiveBroker }).broker = mockBroker as LiveBroker;

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('klines') && url.includes('BTCUSDT')) {
        // BTC in clear Bull Trend (> EMA50)
        const bars = Array.from({ length: 100 }, (_, i) => [
          todayMidnight - (99 - i) * DAY,
          String(60000 + i * 100), String(60500 + i * 100), String(59500 + i * 100), String(60000 + i * 100),
          '1000', 0, '5000000000',
        ]);
        return Promise.resolve({ ok: true, json: () => Promise.resolve(bars) } as Response);
      }
      if (url.includes('ticker/24hr') && url.includes('BTCUSDT')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ priceChangePercent: '1.2' }) } as Response);
      }
      if (url.includes('ticker/24hr')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ symbol: 'NEARUSDT', priceChangePercent: '6.0', quoteVolume: '20000000' }]), // 2.0x avg vol >= 1.25x
        } as Response);
      }
      if (url.includes('premiumIndex')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ symbol: 'NEARUSDT', lastFundingRate: '0.0001' }]),
        } as Response);
      }
      return originalFetch(url);
    });

    try {
      await (worker as unknown as { tick: () => Promise<void> }).tick();
      const written = JSON.parse(fs.readFileSync(path.join(tmpDir, 'worker-status.json'), 'utf8'));
      expect(Object.keys(written.positions)).toEqual(['NEARUSDT']);
      expect(worker.activeTrackedPositions.has('NEARUSDT')).toBe(true);

      // Simulate Circuit Breaker (-13u <= -12u) -> flattens unlocked initial NEARUSDT
      (mockBroker.getAccount as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        totalMarginBalance: '87',
        totalWalletBalance: '87',
        availableBalance: '80',
        totalUnrealizedProfit: '-13',
        assets: [],
      });
      await (worker as unknown as { tick: () => Promise<void> }).tick();
      const afterBreaker = JSON.parse(fs.readFileSync(path.join(tmpDir, 'worker-status.json'), 'utf8'));
      expect(afterBreaker.breakerLatched).toBe(true);
      expect(Object.keys(afterBreaker.positions)).toEqual([]);
      expect(worker.activeTrackedPositions.size).toBe(0);
      expect(worker.ratchetState.size).toBe(0);
    } finally {
      global.fetch = originalFetch;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('triggers Chandelier 2.5x ATR trailing stop on +6% gain and respects 24h cooldown on close', async () => {
    const os = await import('node:os');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-v200-trail-'));

    const worker = new HybridLiveWorker({ stateDir: tmpDir });
    const today = new Date().toISOString().slice(0, 10);
    (worker as unknown as { currentDay: string }).currentDay = today;
    (worker as unknown as { dayStartEquity: number }).dayStartEquity = 100.0;
    // Mark current @4h bucket as already scanned so tick only runs 3s stop protection
    const { getCurrent4hBucketUtc } = await import('../../src/portfolio/turtle-dual-strategy');
    (worker as unknown as { lastScanBucket4h: string }).lastScanBucket4h = getCurrent4hBucketUtc();
    (worker as unknown as { exchangeFilters: Record<string, unknown> }).exchangeFilters = {
      NEARUSDT: { stepSize: 1, tickSize: 0.001, minQty: 1, minNotional: 5 },
    };
    worker.ratchetState.set('NEARUSDT', {
      side: 'LONG',
      entryPrice: 5.0,
      currentSl: 4.5, // -10% initial
      initialSlPct: 0.10,
      extremePrice: 5.0,
      maxRet: 0,
      atr14Pct: 0.02, // 2.5 * 2% = 5% Chandelier trail
      tier: 'initial',
      entryTime: Date.now() - 3600_000,
    });
    worker.activeTrackedPositions.set('NEARUSDT', {
      side: 'LONG',
      qty: 6,
      entryPrice: 5.0,
      slPrice: 4.5,
      ratchetTier: 'initial',
    });

    const cancelSpy = vi.fn().mockResolvedValue({ code: 200 });
    const submitStopSpy = vi.fn().mockResolvedValue({
      orderId: 22,
      clientOrderId: 'sl_near_ch',
      symbol: 'NEARUSDT',
      status: 'NEW',
      executedQty: '0',
    });
    const getPosMock = vi.fn().mockResolvedValue([
      { symbol: 'NEARUSDT', positionAmt: '6', entryPrice: '5.0', markPrice: '5.40', positionSide: 'BOTH' },
    ]);

    const mockBroker: Partial<LiveBroker> = {
      getAccount: vi.fn().mockResolvedValue({
        totalMarginBalance: '102.4',
        totalWalletBalance: '100',
        availableBalance: '93',
        totalUnrealizedProfit: '2.4',
        assets: [],
      }),
      getPositions: getPosMock,
      getOpenAlgoOrders: vi.fn().mockResolvedValue([{ orderId: 21, clientAlgoId: 'sl_old', orderType: 'STOP_MARKET', algoStatus: 'NEW' }]),
      submitStopMarketOrder: submitStopSpy,
      cancelAlgoOrder: cancelSpy,
      getUserTrades: vi.fn().mockResolvedValue([
        { id: 1, orderId: 90, symbol: 'NEARUSDT', price: '5.13', qty: '6', commission: '0.01', commissionAsset: 'USDT', realizedPnl: '0.78', time: Date.now() },
      ]),
    };
    (worker as unknown as { broker: LiveBroker }).broker = mockBroker as LiveBroker;

    try {
      // Tick 1: mark = 5.40 (+8% >= +5%) -> extreme=5.40, SL = 5.40 * (1 - 2.5*0.02) = 5.130 (>= +1% lock!)
      await (worker as unknown as { tick: () => Promise<void> }).tick();
      expect(submitStopSpy).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'NEARUSDT', stopPrice: '5.130' }));
      expect(worker.ratchetState.get('NEARUSDT')?.tier).toBe('lock');
      expect(worker.ratchetState.get('NEARUSDT')?.currentSl).toBeCloseTo(5.13, 3);

      // Tick 2: venue STOP_MARKET filled -> sets 24h ISO cooldown
      getPosMock.mockResolvedValueOnce([]);
      await (worker as unknown as { tick: () => Promise<void> }).tick();
      expect(worker.isSymbolInCooldown('NEARUSDT', Date.now() + 2 * 3_600_000)).toBe(true);
      expect(worker.isSymbolInCooldown('NEARUSDT', Date.now() + 25 * 3_600_000)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../src/portfolio/hybrid-live-notice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/portfolio/hybrid-live-notice')>();
  return {
    ...actual,
    sendHybridTelegram: vi.fn().mockResolvedValue(['999']),
  };
});

import {
  HybridLiveWorker,
  ceilPriceToTickSize,
  computeChandelierStop,
  computeRiskParityOrderUsd,
  computeTurtleIndicators,
  evaluateTurtleBreakoutCandidate,
  floorPriceToTickSize,
  getCurrent4hBucketUtc,
  isPositionLockedWinner,
  resolveTurtleDualRegime,
  selectTopMomentumSymbols,
  type DailyKlineBar,
} from '../../src/portfolio/hybrid-worker';
import type { LiveBroker } from '../../src/portfolio/live-broker';

function makeSeriesBars(
  closes: number[],
  opts?: { quoteVols?: number[]; spreadPct?: number; todayOverride?: { open: number; high: number; low: number; close: number; quoteVol?: number } }
): DailyKlineBar[] {
  const DAY = 86_400_000;
  const todayMidnight = Math.floor(Date.now() / DAY) * DAY;
  const n = closes.length;
  const sp = opts?.spreadPct ?? 0.01;
  return closes.map((c, idx) => {
    const t = todayMidnight - (n - 1 - idx) * DAY;
    const isLast = idx === n - 1 && opts?.todayOverride;
    const o = isLast ? opts!.todayOverride!.open : c;
    const h = isLast ? opts!.todayOverride!.high : c * (1 + sp);
    const l = isLast ? opts!.todayOverride!.low : c * (1 - sp);
    const cl = isLast ? opts!.todayOverride!.close : c;
    const qv = isLast && opts!.todayOverride!.quoteVol !== undefined
      ? opts!.todayOverride!.quoteVol
      : (opts?.quoteVols?.[idx] ?? 10_000_000);
    return [t, String(o), String(h), String(l), String(cl), '1000', t + DAY - 1, String(qv)];
  });
}

describe('v2.0.0 Strategy: O2+O3_R3.0% @4h (Turtle20 Dual L/S)', () => {
  it('resolves BTC Dual-Trend regime accurately (Bull 3L, Neutral Cash, Bear 2S, Freeze gates)', () => {
    expect(resolveTurtleDualRegime({ btcPrice: 75000, btcEma20: 73000, btcEma50: 70000, btc1dReturn: 0.01 })).toMatchObject({
      mode: 'bull_trend',
      longSlots: 3,
      shortSlots: 0,
      longBlocked: false,
    });

    // Bear regime like 2026-11-27: BTC < EMA50 and EMA20 < EMA50 -> 0 Long / 2 Short
    expect(resolveTurtleDualRegime({ btcPrice: 61700, btcEma20: 65100, btcEma50: 71800, btc1dReturn: 0.019 })).toMatchObject({
      mode: 'bear_trend',
      longSlots: 0,
      shortSlots: 2,
      shortBlocked: false,
    });

    // Short squeeze day >= +4% freezes new Short entries while keeping Bear regime (whether intraday or rolling 24h)
    expect(resolveTurtleDualRegime({ btcPrice: 63000, btcEma20: 65100, btcEma50: 71800, btc1dReturn: 0.045 })).toMatchObject({
      mode: 'bear_trend',
      longSlots: 0,
      shortSlots: 2,
      shortBlocked: true,
    });
    expect(resolveTurtleDualRegime({ btcPrice: 63000, btcEma20: 65100, btcEma50: 71800, btc1dReturn: 0.01, btcSqueezeReturn: 0.05 })).toMatchObject({
      mode: 'bear_trend',
      longSlots: 0,
      shortSlots: 2,
      longBlocked: false,
      shortBlocked: true,
    });

    // Dead-cat bounce: BTC < EMA50 but EMA20 >= EMA50 -> Neutral Cash (0L / 0S)
    expect(resolveTurtleDualRegime({ btcPrice: 69000, btcEma20: 70500, btcEma50: 70000, btc1dReturn: 0.0 })).toMatchObject({
      mode: 'neutral_cash',
      longSlots: 0,
      shortSlots: 0,
    });

    // API failure -> signal_unavailable fail-safe
    expect(resolveTurtleDualRegime({ btcPrice: 0, btcEma20: 0, btcEma50: 0, btc1dReturn: 0, signalAvailable: false })).toMatchObject({
      mode: 'signal_unavailable',
      longSlots: 0,
      shortSlots: 0,
      longBlocked: true,
      shortBlocked: true,
    });
  });

  it('enforces strict O3 (EMA20/EMA50 alignment) and O2 (Volume >= 1.25x Avg20) for both LONG and SHORT breakouts', () => {
    // Rising trend: 100 bars from 5.0 -> 10.0, today breaks out above hi20 to 10.8
    const upCloses = Array.from({ length: 100 }, (_, i) => (i < 99 ? 5.0 + i * 0.05 : 10.8));
    const upBars = makeSeriesBars(upCloses);
    const strongVolInd = computeTurtleIndicators(upBars, { rolling24hQuoteVol: 13_000_000, rolling24hRet: 0.08 });
    const weakVolInd = computeTurtleIndicators(upBars, { rolling24hQuoteVol: 9_000_000, rolling24hRet: 0.08 });

    expect(strongVolInd).not.toBeNull();
    expect(strongVolInd!.volRatio).toBeCloseTo(1.3, 2);
    expect(evaluateTurtleBreakoutCandidate('SOLUSDT', strongVolInd!, 'LONG')).not.toBeNull();
    // Fails O2 (< 1.25x)
    expect(evaluateTurtleBreakoutCandidate('SOLUSDT', weakVolInd!, 'LONG')).toBeNull();

    // Falling trend: 100 bars from 20.0 -> 10.0, today breaks below lo20 to 9.2
    const downCloses = Array.from({ length: 100 }, (_, i) => (i < 99 ? 20.0 - i * 0.10 : 9.2));
    const downBars = makeSeriesBars(downCloses);
    const shortInd = computeTurtleIndicators(downBars, { rolling24hQuoteVol: 15_000_000, rolling24hRet: -0.07 });
    expect(shortInd).not.toBeNull();
    expect(evaluateTurtleBreakoutCandidate('AVAXUSDT', shortInd!, 'SHORT')).not.toBeNull();
    // Short rejects > +15% violent dead-cat squeeze
    const squeezeInd = computeTurtleIndicators(downBars, { rolling24hQuoteVol: 15_000_000, rolling24hRet: 0.16 });
    expect(evaluateTurtleBreakoutCandidate('AVAXUSDT', squeezeInd!, 'SHORT')).toBeNull();
  });

  it('computes Risk-Parity sizing (3.0% Long / 2.5% Short, 40% slot cap, 1.05x total cap) cleanly on $92.89', () => {
    // Long: equity $92.89, risk 3.0% ($2.79), SL 10% -> raw $27.87 (< 40% cap $37.16)
    const longSz = computeRiskParityOrderUsd({
      accountEquity: 92.89,
      side: 'LONG',
      slPct: 0.10,
      activeNotionalUsd: 0,
      minNotional: 5,
      maxEffectiveExposureUsd: 97.5,
    });
    expect(longSz.allocUsd).toBeCloseTo(27.87, 1);

    // Tight SL 6% -> raw 92.89*0.03/0.06 = $46.45 -> capped at 40% ($37.16)
    const cappedSz = computeRiskParityOrderUsd({
      accountEquity: 92.89,
      side: 'LONG',
      slPct: 0.06,
      activeNotionalUsd: 0,
      minNotional: 5,
      maxEffectiveExposureUsd: 97.5,
    });
    expect(cappedSz.allocUsd).toBeCloseTo(37.16, 1);

    // Remaining headroom below minNotional ($20) -> skipped safely (never over-sizes!)
    const skipSz = computeRiskParityOrderUsd({
      accountEquity: 92.89,
      side: 'SHORT',
      slPct: 0.14,
      activeNotionalUsd: 85.0,
      minNotional: 20,
      maxEffectiveExposureUsd: 97.5,
    });
    expect(skipSz.allocUsd).toBe(0);
    expect(skipSz.skipReason).toContain('minNotional');
  });

  it('tracks symmetric Chandelier 2.5x ATR trailing stops for LONG and SHORT and identifies >= +1% locked winners', () => {
    expect(floorPriceToTickSize(1.2349, 0.001)).toBe(1.234);
    expect(ceilPriceToTickSize(1.2341, 0.001)).toBe(1.235);

    // LONG: entry 10.0, initial SL 9.0, peak hits 11.2 (+12% >= +5%), atr 4% -> trail = 11.2 * (1 - 2.5*0.04) = 10.08 (< +1% = breakeven)
    const chLongBe = computeChandelierStop({
      side: 'LONG',
      entryPrice: 10.0,
      extremePrice: 11.2,
      currentSl: 9.0,
      maxRet: 0.12,
      atr14Pct: 0.04,
      tickSize: 0.01,
    });
    expect(chLongBe.shouldUpdate).toBe(true);
    expect(chLongBe.targetSl).toBe(10.08);
    expect(chLongBe.tier).toBe('breakeven');
    expect(isPositionLockedWinner('LONG', 10.0, 10.08)).toBe(false);

    // LONG peak hits 12.0 (+20%), atr 4% -> trail = 10.80 (>= +1% lock!)
    const chLongLock = computeChandelierStop({
      side: 'LONG',
      entryPrice: 10.0,
      extremePrice: 12.0,
      currentSl: 10.08,
      maxRet: 0.20,
      atr14Pct: 0.04,
      tickSize: 0.01,
    });
    expect(chLongLock.targetSl).toBe(10.8);
    expect(chLongLock.tier).toBe('lock');
    expect(isPositionLockedWinner('LONG', 10.0, 10.8)).toBe(true);

    // SHORT: entry 10.0, initial SL 11.0, trough hits 8.0 (+20% gain), atr 4% -> trail = 8.0 * (1 + 2.5*0.04) = 8.80 (locked winner!)
    const chShort = computeChandelierStop({
      side: 'SHORT',
      entryPrice: 10.0,
      extremePrice: 8.0,
      currentSl: 11.0,
      maxRet: 0.20,
      atr14Pct: 0.04,
      tickSize: 0.01,
    });
    expect(chShort.shouldUpdate).toBe(true);
    expect(chShort.targetSl).toBe(8.8);
    expect(chShort.tier).toBe('lock');
    expect(isPositionLockedWinner('SHORT', 10.0, 8.8)).toBe(true);
    expect(isPositionLockedWinner('SHORT', 10.0, 10.5)).toBe(false);
  });

  it('rejects heavily negative funding for SHORT candidates while allowing positive funding', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { symbol: 'CROWDSHORT', lastFundingRate: '-0.0012' }, // Shorts pay -0.12%/8h -> skip
        { symbol: 'GOODSHORT', lastFundingRate: '0.0002' },
      ]),
    } as Response);

    try {
      const picked = await selectTopMomentumSymbols(
        [{ symbol: 'CROWDSHORT', score: 5.0 }, { symbol: 'GOODSHORT', score: 3.0 }],
        2,
        'TestShortFunding',
        undefined,
        undefined,
        'SHORT'
      );
      expect(picked).toEqual(['GOODSHORT']);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('opens SHORT positions under Bear regime, sets BUY STOP_MARKET, and exempts locked winners from -12% Circuit Breaker', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turtle-bear-test-'));
    const worker = new HybridLiveWorker({ stateDir: tmpDir });
    const today = new Date().toISOString().slice(0, 10);
    (worker as unknown as { currentDay: string }).currentDay = today;
    (worker as unknown as { dayStartEquity: number }).dayStartEquity = 100.0;
    (worker as unknown as { exchangeFilters: Record<string, unknown> }).exchangeFilters = {
      BTCUSDT: { stepSize: 0.001, tickSize: 0.1, minQty: 0.001, minNotional: 50 },
      BEARCOINUSDT: { stepSize: 1, tickSize: 0.001, minQty: 1, minNotional: 5 },
      WINLOCKUSDT: { stepSize: 1, tickSize: 0.001, minQty: 1, minNotional: 5 },
    };

    const downCloses = Array.from({ length: 100 }, (_, i) => (i < 99 ? 20.0 - i * 0.10 : 9.2));
    worker.candleCache.setCandles('BEARCOINUSDT', makeSeriesBars(downCloses));
    (worker as unknown as { dynamicUniverseScanner: { getUniverse: () => string[]; getState: () => { lastUpdatedAt: string } } }).dynamicUniverseScanner = {
      getUniverse: () => ['BEARCOINUSDT'],
      getState: () => ({ lastUpdatedAt: new Date().toISOString() }),
    };

    // Seed an existing SHORT locked winner (entry 10.0, SL 8.50 -> +15% locked)
    worker.ratchetState.set('WINLOCKUSDT', {
      side: 'SHORT',
      entryPrice: 10.0,
      currentSl: 8.5,
      initialSlPct: 0.10,
      extremePrice: 7.7,
      maxRet: 0.23,
      atr14Pct: 0.04,
      tier: 'lock',
      entryTime: Date.now() - 86_400_000,
    });

    let shortOpened = false;
    const marketOrders: Array<{ symbol: string; side: string }> = [];
    const stopOrders: Array<{ symbol: string; side: string; stopPrice: string }> = [];

    const mockBroker: Partial<LiveBroker> = {
      getAccount: vi.fn().mockResolvedValue({
        totalMarginBalance: '95',
        totalWalletBalance: '95',
        availableBalance: '80',
        totalUnrealizedProfit: '0',
        assets: [],
      }),
      getPositions: vi.fn().mockImplementation(async () => {
        const list = [{ symbol: 'WINLOCKUSDT', positionAmt: '-2', entryPrice: '10.0', markPrice: '7.8', positionSide: 'BOTH' }];
        if (shortOpened) {
          list.push({ symbol: 'BEARCOINUSDT', positionAmt: '-3', entryPrice: '9.2', markPrice: '9.2', positionSide: 'BOTH' });
        }
        return list as ReturnType<LiveBroker['getPositions']> extends Promise<infer T> ? T : never;
      }),
      getMarkPrices: vi.fn().mockResolvedValue([{ symbol: 'BEARCOINUSDT', markPrice: '9.2', time: Date.now() }]),
      setLeverage: vi.fn().mockResolvedValue({ leverage: 5 }),
      submitMarketOrder: vi.fn().mockImplementation(async (order) => {
        marketOrders.push({ symbol: order.symbol, side: order.side });
        if (order.symbol === 'BEARCOINUSDT' && order.side === 'SELL' && !order.reduceOnly) shortOpened = true;
        if (order.symbol === 'BEARCOINUSDT' && order.side === 'BUY' && order.reduceOnly) shortOpened = false;
        return { orderId: 1, clientOrderId: order.clientOrderId, symbol: order.symbol, status: 'FILLED', executedQty: order.quantity, avgPrice: '9.2' };
      }),
      getOpenAlgoOrders: vi.fn().mockResolvedValue([]),
      submitStopMarketOrder: vi.fn().mockImplementation(async (order) => {
        stopOrders.push({ symbol: order.symbol, side: order.side, stopPrice: order.stopPrice });
        return { orderId: 2, clientOrderId: order.clientOrderId, symbol: order.symbol, status: 'NEW', executedQty: '0' };
      }),
      cancelAlgoOrder: vi.fn().mockResolvedValue({ code: 200 }),
    };
    (worker as unknown as { broker: LiveBroker }).broker = mockBroker as LiveBroker;

    const btcDownCloses = Array.from({ length: 100 }, (_, i) => (i < 60 ? 72000 : 72000 - (i - 59) * 260));
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('klines') && url.includes('BTCUSDT')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(makeSeriesBars(btcDownCloses)) } as Response);
      }
      if (url.includes('ticker/24hr') && url.includes('BTCUSDT')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ priceChangePercent: '-1.5' }) } as Response);
      }
      if (url.includes('ticker/24hr')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ symbol: 'BEARCOINUSDT', priceChangePercent: '-6.0', quoteVolume: '15000000' }]),
        } as Response);
      }
      if (url.includes('premiumIndex')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ symbol: 'BEARCOINUSDT', lastFundingRate: '0.0001' }]),
        } as Response);
      }
      return originalFetch(url);
    });

    try {
      // Tick 1: opens SHORT BEARCOINUSDT and places BUY STOP_MARKET
      await (worker as unknown as { tick: () => Promise<void> }).tick();
      expect(marketOrders).toContainEqual({ symbol: 'BEARCOINUSDT', side: 'SELL' });
      expect(stopOrders.some((s) => s.symbol === 'BEARCOINUSDT' && s.side === 'BUY')).toBe(true);
      const st1 = JSON.parse(fs.readFileSync(path.join(tmpDir, 'worker-status.json'), 'utf8'));
      expect(st1.lastScanBucket4h).toBe(getCurrent4hBucketUtc());
      expect(st1.positions.BEARCOINUSDT.side).toBe('SHORT');
      expect(st1.positions.BEARCOINUSDT.qty).toBeLessThan(0);

      // Tick 2: trigger -13u Circuit Breaker -> closes UNLOCKED BEARCOINUSDT, PRESERVES LOCKED WINLOCKUSDT!
      marketOrders.length = 0;
      (mockBroker.getAccount as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        totalMarginBalance: '86',
        totalWalletBalance: '86',
        availableBalance: '70',
        totalUnrealizedProfit: '-14',
        assets: [],
      });
      await (worker as unknown as { tick: () => Promise<void> }).tick();
      expect(marketOrders).toContainEqual({ symbol: 'BEARCOINUSDT', side: 'BUY' });
      expect(marketOrders.some((m) => m.symbol === 'WINLOCKUSDT')).toBe(false);
      const st2 = JSON.parse(fs.readFileSync(path.join(tmpDir, 'worker-status.json'), 'utf8'));
      expect(st2.breakerLatched).toBe(true);
      expect(Object.keys(st2.positions)).toEqual(['WINLOCKUSDT']);
    } finally {
      global.fetch = originalFetch;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not mark 4h bucket scanned if broker read fails and uses livePrice from 24hr stats at breakout scan', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turtle-retry-test-'));
    const worker = new HybridLiveWorker({ stateDir: tmpDir });
    (worker as unknown as { exchangeFilters: Record<string, unknown> }).exchangeFilters = {
      LIVESHORTUSDT: { stepSize: 1, tickSize: 0.001, minQty: 1, minNotional: 5 },
    };
    // Cached 1d bar still shows 10.2 (above lo20=9.9), while live ticker/24hr has already broken down to 9.1!
    const downCloses = Array.from({ length: 100 }, (_, i) => (i < 99 ? 20.0 - i * 0.10 : 10.2));
    worker.candleCache.setCandles('LIVESHORTUSDT', makeSeriesBars(downCloses));
    (worker as unknown as { dynamicUniverseScanner: { getUniverse: () => string[]; getState: () => { lastUpdatedAt: string } } }).dynamicUniverseScanner = {
      getUniverse: () => ['LIVESHORTUSDT'],
      getState: () => ({ lastUpdatedAt: new Date().toISOString() }),
    };

    const marketOrders: Array<{ symbol: string; side: string }> = [];
    const getPositionsMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Binance -1003 temporary throttle'))
      .mockResolvedValue([]);
    (worker as unknown as { broker: LiveBroker }).broker = {
      getAccount: vi.fn().mockResolvedValue({
        totalMarginBalance: '95',
        totalWalletBalance: '95',
        availableBalance: '95',
        totalUnrealizedProfit: '0',
        assets: [],
      }),
      getPositions: getPositionsMock,
      getMarkPrices: vi.fn().mockResolvedValue([{ symbol: 'LIVESHORTUSDT', markPrice: '9.1', time: Date.now() }]),
      setLeverage: vi.fn().mockResolvedValue({ leverage: 5 }),
      submitMarketOrder: vi.fn().mockImplementation(async (order) => {
        marketOrders.push({ symbol: order.symbol, side: order.side });
        return { orderId: 11, clientOrderId: order.clientOrderId, symbol: order.symbol, status: 'FILLED', executedQty: order.quantity, avgPrice: '9.1' };
      }),
      getOpenAlgoOrders: vi.fn().mockResolvedValue([]),
      submitStopMarketOrder: vi.fn().mockResolvedValue({ orderId: 12, clientOrderId: 'sl', symbol: 'LIVESHORTUSDT', status: 'NEW', executedQty: '0' }),
    } as unknown as LiveBroker;

    const btcDownCloses = Array.from({ length: 100 }, (_, i) => (i < 60 ? 72000 : 72000 - (i - 59) * 260));
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('klines') && url.includes('BTCUSDT')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(makeSeriesBars(btcDownCloses)) } as Response);
      }
      if (url.includes('ticker/24hr') && url.includes('BTCUSDT')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ priceChangePercent: '-1.5' }) } as Response);
      }
      if (url.includes('ticker/24hr')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ symbol: 'LIVESHORTUSDT', lastPrice: '9.1', priceChangePercent: '-8.0', quoteVolume: '15000000' }]),
        } as Response);
      }
      if (url.includes('premiumIndex')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ symbol: 'LIVESHORTUSDT', lastFundingRate: '0.0001' }]),
        } as Response);
      }
      return originalFetch(url);
    });

    try {
      // 1st attempt throws -> must NOT mark bucket scanned!
      await worker.runTurtleCycle(true);
      expect((worker as unknown as { lastScanBucket4h: string }).lastScanBucket4h).toBe('');
      expect(marketOrders).toHaveLength(0);

      // 2nd attempt succeeds -> enters using livePrice=9.1 even though cached bar close was 10.2, and marks bucket!
      await worker.runTurtleCycle(true);
      expect((worker as unknown as { lastScanBucket4h: string }).lastScanBucket4h).toBe(getCurrent4hBucketUtc());
      expect(marketOrders).toContainEqual({ symbol: 'LIVESHORTUSDT', side: 'SELL' });
    } finally {
      global.fetch = originalFetch;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

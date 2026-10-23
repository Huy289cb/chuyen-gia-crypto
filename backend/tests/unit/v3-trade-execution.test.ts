import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/repositories/testnet.repository', () => ({
  getOrCreateTestnetAccount: vi.fn(),
  getActiveTestnetPositions: vi.fn(),
  getBlockingTestnetPendingOrders: vi.fn(),
  createTestnetPendingOrder: vi.fn(),
  recordPipelineEvent: vi.fn().mockResolvedValue(1),
  recordSilentPipelineEvent: vi.fn().mockResolvedValue(1),
}));

vi.mock('../../src/services/v3-entry-eligibility.service', () => ({
  assertScaleInSideAllowed: vi.fn(),
  assertSameSidePostCloseCooldown: vi.fn(),
  getSymbolExposureSnapshot: vi.fn(),
  oppositeLocalSide: (side: 'long' | 'short') => (side === 'long' ? 'short' : 'long'),
}));

vi.mock('../../src/config/v3-entry-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/v3-entry-policy')>();
  return {
    ...actual,
    isV3ScaleInEnabled: vi.fn(() => true),
    isV3OppositeFlipEnabled: vi.fn(() => false),
    getBinanceMinOrderNotionalUsd: vi.fn(() => 50),
    resolveMaxTotalExposureUsd: vi.fn((_b: number, fallback: number) => fallback),
  };
});

vi.mock('../../src/services/opposite-flip.service', () => ({
  tryOppositeFlipBeforeEntry: vi.fn().mockResolvedValue({ flipped: false, reason: 'no opposite exposure' }),
}));

vi.mock('../../src/services/account-risk-guard.service', () => ({
  assertTestnetAccountCanOpenTrade: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('../../src/services/binance-account-health.service', () => ({
  checkBinanceAccountTradable: vi.fn().mockResolvedValue({ tradable: true, reason: 'ok' }),
}));

vi.mock('../../src/services/binance-hedge-mode', () => ({
  ensurePositionModeDetected: vi.fn().mockResolvedValue('ONE_WAY'),
}));

vi.mock('../../src/services/binanceClient', () => ({
  initTestnetClient: vi.fn(),
  normalizeQuantityForSymbol: vi.fn(),
  placeLimitOrder: vi.fn(),
}));

vi.mock('../../src/config/methods', () => ({
  getMethodConfig: vi.fn(() => ({
    autoEntry: {
      minSLDistancePercent: 0.005,
      minRRRatio: 3,
      maxPositionsPerSymbol: 6,
      maxPendingVolume: 2000,
      maxPendingOrderSize: 2000,
    },
  })),
}));

import { getAiOpportunityPolicy } from '../../src/config/ai-opportunity-policy';
import { opportunityFixture } from '../fixtures/ai-opportunity';
import { ensurePositionModeDetected } from '../../src/services/binance-hedge-mode';
import { assertTestnetAccountCanOpenTrade } from '../../src/services/account-risk-guard.service';
import { executeV3Trade } from '../../src/services/v3-trade-execution.service';
import {
  getOrCreateTestnetAccount,
  getActiveTestnetPositions,
  getBlockingTestnetPendingOrders,
  createTestnetPendingOrder,
  recordSilentPipelineEvent,
} from '../../src/repositories/testnet.repository';
import {
  assertScaleInSideAllowed,
  assertSameSidePostCloseCooldown,
  getSymbolExposureSnapshot,
} from '../../src/services/v3-entry-eligibility.service';
import { isV3ScaleInEnabled } from '../../src/config/v3-entry-policy';
import { checkBinanceAccountTradable } from '../../src/services/binance-account-health.service';
import {
  initTestnetClient,
  normalizeQuantityForSymbol,
  placeLimitOrder,
} from '../../src/services/binanceClient';

describe('executeV3Trade', () => {
  it('records effective admission inputs under the pinned risk contract', async () => {
    process.env.RISK_PER_TRADE_PERCENT='0.5';process.env.MAX_EFFECTIVE_RISK_PER_TRADE_PERCENT='3';
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({id:1,current_balance:32.2} as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([]);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);
    vi.mocked(getSymbolExposureSnapshot).mockResolvedValue({openUsd:0,pendingUsd:0,totalUsd:0,maxExposureUsd:100,remainingUsd:100,openSides:[],pendingSides:[]});
    vi.mocked(initTestnetClient).mockReturnValue({} as never);
    vi.mocked(normalizeQuantityForSymbol).mockResolvedValue({rawQty:.000625,normalizedQty:.001,stepSize:.001,minQty:.001,valid:true});
    vi.mocked(placeLimitOrder).mockResolvedValue({orderId:12345} as never);
    vi.mocked(createTestnetPendingOrder).mockResolvedValue({order_id:'synthetic'} as never);
    const result=await executeV3Trade({symbol:'BTC',timeframe:'1h',analysis:{bias:'bullish',action:'buy',confidence:.9,
      suggested_entry:80000,suggested_stop_loss:79360,suggested_take_profit:81920,expected_rr:3}});
    expect(result.success).toBe(true);
    const events=vi.mocked(recordSilentPipelineEvent).mock.calls.map(c=>c[1] as Record<string,unknown>);
    expect(events.find(e=>e.stage==='quantity_checked')).toMatchObject({admission_schema:'financial-inputs-v1',
      entry:80000,stop_loss:79360,account_balance:32.2,target_risk_percent:.5,selected_notional_usd:50,normalized_quantity:.001});
    expect(events.find(e=>e.stage==='risk_checked')).toMatchObject({admission_schema:'financial-inputs-v1',
      entry:80000,stop_loss:79360,account_balance:32.2,normalized_quantity:.001,max_risk_percent:3});
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertTestnetAccountCanOpenTrade).mockResolvedValue({ allowed: true });
    process.env.BINANCE_ENABLED = 'true';
    process.env.RISK_PER_TRADE_PERCENT = '1';
    process.env.MAX_EFFECTIVE_RISK_PER_TRADE_PERCENT = '2';
    delete process.env.MAX_EFFECTIVE_RISK_PER_TRADE_USD;
    process.env.MIN_SL_DISTANCE_PERCENT = '0.008';
    delete process.env.MINIMUM_LOT_STOP_NORMALIZATION_ENABLED;
    vi.mocked(isV3ScaleInEnabled).mockReturnValue(true);
    vi.mocked(assertScaleInSideAllowed).mockResolvedValue(null);
    vi.mocked(assertSameSidePostCloseCooldown).mockResolvedValue(null);
    vi.mocked(getSymbolExposureSnapshot).mockResolvedValue({
      openUsd: 0,
      pendingUsd: 0,
      totalUsd: 0,
      maxExposureUsd: 2000,
      remainingUsd: 2000,
      openSides: [],
      pendingSides: [],
    });
    vi.mocked(checkBinanceAccountTradable).mockResolvedValue({ tradable: true, reason: 'ok' });
  });

  it('rejects when BINANCE_ENABLED is false', async () => {
    process.env.BINANCE_ENABLED = 'false';
    const result = await executeV3Trade({
      symbol: 'BTC',
      timeframe: '1h',
      analysis: {
        bias: 'bullish',
        action: 'buy',
        confidence: 0.9,
        suggested_entry: 100000,
        suggested_stop_loss: 99000,
        suggested_take_profit: 103000,
      },
    });
    expect(result.success).toBe(false);
    expect(result.reason).toContain('BINANCE_ENABLED');
  });

  it('places limit order and creates pending order on valid trade', async () => {
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 10000,
    } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([]);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);
    vi.mocked(initTestnetClient).mockReturnValue({} as never);
    vi.mocked(normalizeQuantityForSymbol).mockResolvedValue({
      rawQty: 0.01,
      normalizedQty: 0.01,
      stepSize: 0.0001,
      minQty: 0.0001,
      valid: true,
    });
    vi.mocked(placeLimitOrder).mockResolvedValue({ orderId: 12345 } as never);
    vi.mocked(createTestnetPendingOrder).mockResolvedValue({ order_id: 'v3_test' } as never);

    const result = await executeV3Trade({
      symbol: 'BTC',
      timeframe: '1h',
      analysis: {
        bias: 'bullish',
        action: 'buy',
        confidence: 0.9,
        suggested_entry: 100000,
        suggested_stop_loss: 99000,
        suggested_take_profit: 103000,
        expected_rr: 3,
      },
    });

    expect(result.success).toBe(true);
    expect(result.binanceOrderId).toBe('12345');
    expect(placeLimitOrder).toHaveBeenCalled();
  });

  it('allows same-side scale-in when under exposure cap', async () => {
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 10000,
    } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([
      { side: 'long', size_usd: 700 },
    ] as never);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);
    vi.mocked(getSymbolExposureSnapshot).mockResolvedValue({
      openUsd: 700,
      pendingUsd: 0,
      totalUsd: 700,
      maxExposureUsd: 2000,
      remainingUsd: 1300,
      openSides: ['long'],
      pendingSides: [],
    });
    vi.mocked(normalizeQuantityForSymbol).mockResolvedValue({
      rawQty: 0.01,
      normalizedQty: 0.01,
      stepSize: 0.0001,
      minQty: 0.0001,
      valid: true,
    });
    vi.mocked(initTestnetClient).mockReturnValue({} as never);
    vi.mocked(placeLimitOrder).mockResolvedValue({ orderId: 999 } as never);
    vi.mocked(createTestnetPendingOrder).mockResolvedValue({ order_id: 'v3_scale' } as never);

    const result = await executeV3Trade({
      symbol: 'BTC',
      timeframe: '1h',
      analysis: {
        bias: 'bullish',
        action: 'buy',
        confidence: 0.9,
        suggested_entry: 100000,
        suggested_stop_loss: 99000,
        suggested_take_profit: 103000,
      },
    });

    expect(result.success).toBe(true);
    expect(placeLimitOrder).toHaveBeenCalled();
  });

  it('rejects same-side open when scale-in disabled', async () => {
    vi.mocked(isV3ScaleInEnabled).mockReturnValue(false);
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 10000,
    } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([
      { side: 'long', size_usd: 500 },
    ] as never);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);

    const result = await executeV3Trade({
      symbol: 'BTC',
      timeframe: '1h',
      analysis: {
        bias: 'bullish',
        action: 'buy',
        confidence: 0.9,
        suggested_entry: 100000,
        suggested_stop_loss: 99000,
        suggested_take_profit: 103000,
      },
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain('Same-side');
    expect(placeLimitOrder).not.toHaveBeenCalled();
  });

  it('rejects opposite side when scale-in enabled', async () => {
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 10000,
    } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([
      { side: 'short', size_usd: 700 },
    ] as never);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);

    const result = await executeV3Trade({
      symbol: 'BTC',
      timeframe: '1h',
      analysis: {
        bias: 'bullish',
        action: 'buy',
        confidence: 0.9,
        suggested_entry: 100000,
        suggested_stop_loss: 99000,
        suggested_take_profit: 103000,
      },
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain('Opposite');
    expect(placeLimitOrder).not.toHaveBeenCalled();
  });

  it('rejects when assertScaleInSideAllowed blocks (Binance same-side, scale-in off)', async () => {
    vi.mocked(isV3ScaleInEnabled).mockReturnValue(false);
    vi.mocked(assertScaleInSideAllowed).mockResolvedValue(
      'Binance already has long exposure for BTC (scaling-in disabled)'
    );
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 10000,
    } as never);

    const result = await executeV3Trade({
      symbol: 'BTC',
      timeframe: '1h',
      analysis: {
        bias: 'bullish',
        action: 'buy',
        confidence: 0.9,
        suggested_entry: 100000,
        suggested_stop_loss: 99000,
        suggested_take_profit: 103000,
      },
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain('Binance already has');
    expect(placeLimitOrder).not.toHaveBeenCalled();
  });

  it('rejects when post-close cooldown active', async () => {
    vi.mocked(assertSameSidePostCloseCooldown).mockResolvedValue(
      'post-close cooldown 60m after loss (360m window, last long)'
    );
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 10000,
    } as never);

    const result = await executeV3Trade({
      symbol: 'BTC',
      timeframe: '1h',
      analysis: {
        bias: 'bullish',
        action: 'buy',
        confidence: 0.9,
        suggested_entry: 100000,
        suggested_stop_loss: 99000,
        suggested_take_profit: 103000,
      },
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain('post-close cooldown');
    expect(placeLimitOrder).not.toHaveBeenCalled();
  });

  it('rejects at max exposure even with scale-in', async () => {
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 10000,
    } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([
      { side: 'short', size_usd: 2000 },
    ] as never);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);
    vi.mocked(getSymbolExposureSnapshot).mockResolvedValue({
      openUsd: 2000,
      pendingUsd: 0,
      totalUsd: 2000,
      maxExposureUsd: 2000,
      remainingUsd: 0,
      openSides: ['short'],
      pendingSides: [],
    });

    const result = await executeV3Trade({
      symbol: 'BTC',
      timeframe: '1h',
      analysis: {
        bias: 'bearish',
        action: 'sell',
        confidence: 0.9,
        suggested_entry: 100000,
        suggested_stop_loss: 101000,
        suggested_take_profit: 98000,
      },
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain('Max exposure');
  });

  it('rejects scale-in when headroom below Binance min notional', async () => {
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 5000,
    } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([
      { side: 'long', size_usd: 736 },
    ] as never);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);
    vi.mocked(getSymbolExposureSnapshot).mockResolvedValue({
      openUsd: 736,
      pendingUsd: 0,
      totalUsd: 736,
      maxExposureUsd: 750,
      remainingUsd: 14,
      openSides: ['long'],
      pendingSides: [],
    });

    const result = await executeV3Trade({
      symbol: 'BTC',
      timeframe: '1h',
      analysis: {
        bias: 'bullish',
        action: 'buy',
        confidence: 0.9,
        suggested_entry: 64500,
        suggested_stop_loss: 63950,
        suggested_take_profit: 65700,
      },
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain('below Binance min order');
    expect(placeLimitOrder).not.toHaveBeenCalled();
  });

  it('uses one minimum lot without breaching the effective-risk cap (50U wallet)', async () => {
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 50,
    } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([]);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);
    vi.mocked(initTestnetClient).mockReturnValue({} as never);
    vi.mocked(normalizeQuantityForSymbol).mockResolvedValue({
      rawQty: 50 / 64380,
      normalizedQty: 0,
      stepSize: 0.001,
      minQty: 0.001,
      valid: true,
    });
    vi.mocked(placeLimitOrder).mockResolvedValue({ orderId: 77777 } as never);
    vi.mocked(createTestnetPendingOrder).mockResolvedValue({ order_id: 'v3_tol' } as never);

    const result = await executeV3Trade({
      symbol: 'BTC',
      timeframe: '15m',
      analysis: {
        bias: 'bullish',
        action: 'buy',
        confidence: 0.92,
        suggested_entry: 64380,
        suggested_stop_loss: 63630,
        suggested_take_profit: 66630,
      },
    });

    expect(result.success).toBe(true);
    expect(placeLimitOrder).toHaveBeenCalledWith(
      expect.anything(),
      'BTCUSDT',
      'BUY',
      0.001,
      64380,
      'OPEN',
      null,
      null,
      expect.any(String)
    );
    const pendingInput = vi.mocked(createTestnetPendingOrder).mock.calls[0]?.[0];
    expect(pendingInput).toEqual(expect.objectContaining({ sizeQty: 0.001, sizeUsd: 64.38 }));
    expect(pendingInput?.riskUsd).toBeCloseTo(0.87876, 8);
    expect(pendingInput?.riskPercent).toBeCloseTo(1.75752, 8);
  });

  it('rejects a minimum lot when its stop risk breaches the wallet cap', async () => {
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 40,
    } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([]);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);
    vi.mocked(initTestnetClient).mockReturnValue({} as never);
    vi.mocked(normalizeQuantityForSymbol).mockResolvedValue({
      rawQty: 50 / 64380,
      normalizedQty: 0,
      stepSize: 0.001,
      minQty: 0.001,
      valid: false,
    });

    const result = await executeV3Trade({
      symbol: 'BTC',
      timeframe: '15m',
      analysis: {
        bias: 'bullish',
        action: 'buy',
        confidence: 0.92,
        suggested_entry: 64380,
        suggested_stop_loss: 63092.4,
        suggested_take_profit: 68242.8,
      },
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain('Exchange minimum would risk');
    expect(placeLimitOrder).not.toHaveBeenCalled();
  });

  it('preserves the structural stop even when the legacy normalization flag is enabled', async () => {
    process.env.MINIMUM_LOT_STOP_NORMALIZATION_ENABLED = 'true';
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 34.27714639,
    } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([]);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);
    vi.mocked(initTestnetClient).mockReturnValue({} as never);
    vi.mocked(normalizeQuantityForSymbol).mockResolvedValue({
      rawQty: 50 / 79_894.5,
      normalizedQty: 0,
      stepSize: 0.001,
      minQty: 0.001,
      tickSize: 0.1,
      valid: false,
    });
    vi.mocked(placeLimitOrder).mockResolvedValue({ orderId: 88888 } as never);
    vi.mocked(createTestnetPendingOrder).mockResolvedValue({ order_id: 'v3_normalized' } as never);

    const result = await executeV3Trade({
      symbol: 'BTC',
      timeframe: '15m',
      requiredMinRr: 3,
      analysis: {
        bias: 'bullish',
        action: 'buy',
        confidence: 0.92,
        suggested_entry: 79_894.5,
        suggested_stop_loss: 78_730,
        suggested_take_profit: 83_388,
      },
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain('after fees/slippage');
    expect(placeLimitOrder).not.toHaveBeenCalled();
    expect(result.levelAdjustment).toBeUndefined();
  });

  it('still rejects when minimum lot cannot support the minimum stop', async () => {
    process.env.MINIMUM_LOT_STOP_NORMALIZATION_ENABLED = 'true';
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({
      id: 1,
      current_balance: 20,
    } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([]);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);
    vi.mocked(normalizeQuantityForSymbol).mockResolvedValue({
      rawQty: 50 / 80_000,
      normalizedQty: 0,
      stepSize: 0.001,
      minQty: 0.001,
      tickSize: 0.1,
      valid: false,
    });

    const result = await executeV3Trade({
      symbol: 'BTC',
      timeframe: '15m',
      requiredMinRr: 3,
      analysis: {
        bias: 'bullish',
        action: 'buy',
        confidence: 0.92,
        suggested_entry: 80_000,
        suggested_stop_loss: 78_800,
        suggested_take_profit: 83_600,
      },
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain('Exchange minimum would risk');
    expect(placeLimitOrder).not.toHaveBeenCalled();
  });

  it.each([
    { side: 'long', balance: 34.27714639, stopFraction: .008, dailyBudget: 1.03, allowed: true },
    { side: 'short', balance: 34.27714639, stopFraction: .008, dailyBudget: 1.03, allowed: true },
    { side: 'long', balance: 25, stopFraction: .008, dailyBudget: 1.03, allowed: true },
    { side: 'long', balance: 34.27714639, stopFraction: .012, dailyBudget: 1.03, allowed: false },
    { side: 'long', balance: 34.27714639, stopFraction: .008, dailyBudget: .70, allowed: false },
  ])('enforces fixed 1 USDT including costs and remaining daily budget: %j', async (sample) => {
    process.env.MAX_EFFECTIVE_RISK_PER_TRADE_USD = '1';
    process.env.CIRCUIT_DAILY_LOSS_ENABLED = 'true';
    vi.mocked(assertTestnetAccountCanOpenTrade).mockResolvedValue({ allowed: true, remainingDailyRiskUsd: sample.dailyBudget });
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({ id: 1, current_balance: sample.balance } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([]);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);
    vi.mocked(initTestnetClient).mockReturnValue({} as never);
    vi.mocked(normalizeQuantityForSymbol).mockResolvedValue({ rawQty: .0001, normalizedQty: 0, stepSize: .001, minQty: .001, valid: false });
    vi.mocked(placeLimitOrder).mockResolvedValue({ orderId: 99999 } as never);
    vi.mocked(createTestnetPendingOrder).mockResolvedValue({ order_id: 'risk_usd_test' } as never);
    const sign = sample.side === 'long' ? 1 : -1;
    const entry = 79425;
    const stop = entry * (1 - sign * sample.stopFraction);
    const target = entry * (1 + sign * sample.stopFraction * 3);
    const result = await executeV3Trade({ symbol: 'BTC', timeframe: '15m', analysis: {
      bias: sign === 1 ? 'bullish' : 'bearish', action: sign === 1 ? 'buy' : 'sell', confidence: .92,
      suggested_entry: entry, suggested_stop_loss: stop, suggested_take_profit: target,
    }});
    expect(result.success).toBe(sample.allowed);
    if (sample.allowed) {
      expect(placeLimitOrder).toHaveBeenCalledTimes(1);
      const pending = vi.mocked(createTestnetPendingOrder).mock.calls[0][0];
      expect(pending.riskUsd).toBeLessThanOrEqual(1);
      expect(pending).toEqual(expect.objectContaining({ stopLoss: stop }));
    } else {
      expect(placeLimitOrder).not.toHaveBeenCalled();
      expect(result.reason).toContain(sample.dailyBudget < .8 ? 'daily loss budget' : 'cap 1.0000 USDT');
    }
  });

});


describe('sealed AI opportunity execution boundary (exchange mocked)', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
  function setup() {
    vi.clearAllMocks();
    const f = opportunityFixture();
    vi.useFakeTimers(); vi.setSystemTime(f.now);
    for (const [key, value] of Object.entries({
      BINANCE_ENABLED: 'true', AI_OPPORTUNITY_MODE: 'live', RISK_PER_TRADE_PERCENT: '0.5',
      MAX_EFFECTIVE_RISK_PER_TRADE_PERCENT: '3', MAX_EFFECTIVE_RISK_PER_TRADE_USD: '',
      DAILY_LOSS_LIMIT_PERCENT: '10', CONSECUTIVE_LOSS_COOLDOWN_HOURS: '1',
      LOSS_COOLDOWN_TIER2_HOURS: '1', LOSS_COOLDOWN_TIER3_HOURS: '1',
      LOSS_COOLDOWN_TIER3_UNTIL_UTC_DAY: 'false', CIRCUIT_EXPECTANCY_COOLDOWN_HOURS: '1',
      POST_CLOSE_SAME_SIDE_COOLDOWN_MINUTES: '60', POST_LOSS_SAME_SIDE_COOLDOWN_MINUTES: '60',
      PENDING_ORDER_REENTRY_COOLDOWN_MINUTES: '60', MIN_SL_DISTANCE_PERCENT: '0.008',
    })) vi.stubEnv(key, value);
    const policy = getAiOpportunityPolicy();
    expect(policy.pinned).toBe(true);
    vi.stubEnv('AI_OPPORTUNITY_LIVE_POLICY_HASH', policy.hash);
    vi.mocked(getOrCreateTestnetAccount).mockResolvedValue({ id: 1, current_balance: 100 } as never);
    vi.mocked(assertTestnetAccountCanOpenTrade).mockResolvedValue({ allowed: true, remainingDailyRiskUsd: 10 } as never);
    vi.mocked(getActiveTestnetPositions).mockResolvedValue([]);
    vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([]);
    vi.mocked(assertScaleInSideAllowed).mockResolvedValue(null);
    vi.mocked(assertSameSidePostCloseCooldown).mockResolvedValue(null);
    vi.mocked(checkBinanceAccountTradable).mockResolvedValue({ tradable: true, reason: 'ok' });
    vi.mocked(getSymbolExposureSnapshot).mockResolvedValue({ totalUsd: 0, openUsd: 0, pendingUsd: 0,
      maxExposureUsd: 1000, remainingUsd: 1000, openSides: [], pendingSides: [] });
    vi.mocked(normalizeQuantityForSymbol).mockResolvedValue({ stepSize: .001, minQty: .001, valid: true } as never);
    vi.mocked(initTestnetClient).mockReturnValue({} as never);
    vi.mocked(ensurePositionModeDetected).mockResolvedValue('ONE_WAY' as never);
    vi.mocked(placeLimitOrder).mockResolvedValue({ orderId: 123 } as never);
    vi.mocked(createTestnetPendingOrder).mockResolvedValue({ order_id: 'mock' } as never);
    const p = f.plan;
    return { symbol: 'BTC', timeframe: '15m', requiredMinRr: 3,
      analysis: { action: 'buy', bias: 'bullish', confidence: 0, suggested_entry: p.entry,
        suggested_stop_loss: p.stopLoss, suggested_take_profit: p.takeProfit, invalidation_level: p.invalidation },
      opportunityContract: { plan: p, snapshotAt: f.now, policyHash: policy.hash } };
  }
  it('places exactly the reviewed price and quantity through the mocked exchange', async () => {
    const input = setup();
    const result = await executeV3Trade(input as never);
    expect(result.success).toBe(true);
    expect(placeLimitOrder).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'BTCUSDT', 'BUY',
      input.opportunityContract.plan.quantity, input.opportunityContract.plan.entry, 'OPEN', null, null, expect.any(String));
  });
  it.each(['price', 'pin', 'expired', 'quantity', 'position', 'pending', 'late_mode', 'late_expiry'])('blocks %s before any order', async kind => {
    const input = setup();
    if (kind === 'price') input.analysis.suggested_entry += 1;
    if (kind === 'pin') vi.stubEnv('AI_OPPORTUNITY_LIVE_POLICY_HASH', 'wrong');
    if (kind === 'expired') input.opportunityContract.plan.expiresAt = Date.now();
    if (kind === 'quantity') input.opportunityContract.plan.quantity /= 2;
    if (kind === 'position') vi.mocked(getActiveTestnetPositions).mockResolvedValue([{ side: 'long' }] as never);
    if (kind === 'pending') vi.mocked(getBlockingTestnetPendingOrders).mockResolvedValue([{ side: 'short' }] as never);
    if (kind === 'late_mode') vi.mocked(ensurePositionModeDetected).mockImplementation(async () => {
      vi.stubEnv('AI_OPPORTUNITY_MODE', 'off'); return 'ONE_WAY' as never;
    });
    if (kind === 'late_expiry') vi.mocked(ensurePositionModeDetected).mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 180001); return 'ONE_WAY' as never;
    });
    const result = await executeV3Trade(input as never);
    expect(result.success).toBe(false);
    expect(placeLimitOrder).not.toHaveBeenCalled();
  });
});

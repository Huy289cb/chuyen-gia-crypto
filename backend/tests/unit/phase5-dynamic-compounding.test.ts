import { describe, it, expect } from 'vitest';
import {
  DynamicCompoundingManager,
  MOMENTUM_ALLOC_PCT,
  BTC_GRID_TICKET_PCT,
  DAILY_LOSS_LIMIT_PCT,
  BASELINE_DAILY_LOSS_LIMIT_USD,
} from '../../src/portfolio/dynamic-compounding';
import {
  VolatilityGridController,
  BASELINE_ATR_PCT,
  BASE_STEP_PCT,
  BASE_TP_PCT,
  type CandleData,
} from '../../src/portfolio/volatility-grid';
import { formatHybridCommandResponse } from '../../src/portfolio/hybrid-live-notice';
import type { HybridLiveState } from '../../src/portfolio/hybrid-worker';

describe('Phase 5: Dynamic Compounding & Volatility-Scaled Grid', () => {
  describe('Part 1: DynamicCompoundingManager', () => {
    const manager = new DynamicCompoundingManager(5.0);

    it('defines core quantitative compounding parameters', () => {
      expect(MOMENTUM_ALLOC_PCT).toBe(0.24);
      expect(BTC_GRID_TICKET_PCT).toBe(0.14);
      expect(DAILY_LOSS_LIMIT_PCT).toBe(0.12);
      expect(BASELINE_DAILY_LOSS_LIMIT_USD).toBe(12.0);
    });

    it('computes momentum position sizing in proportion to realized equity', () => {
      // At baseline 100 USDT equity -> 24.00 USDT
      expect(manager.computeMomentumAlloc(100.0)).toBe(24.0);

      // At 200 USDT equity -> 48.00 USDT
      expect(manager.computeMomentumAlloc(200.0)).toBe(48.0);

      // At 500 USDT equity -> 120.00 USDT
      expect(manager.computeMomentumAlloc(500.0)).toBe(120.0);

      // At small equity (30 USDT) -> 7.20 USDT (> 5.0 minNotional)
      expect(manager.computeMomentumAlloc(30.0)).toBe(7.2);

      // At very small equity (15 USDT) with 0.24 = 3.60u -> floored to minNotional 5.0u
      expect(manager.computeMomentumAlloc(15.0)).toBe(5.0);
    });

    it('computes BTC grid ticket sizing in proportion to realized equity', () => {
      // At baseline 100 USDT equity -> 14.00 USDT
      expect(manager.computeGridTicket(100.0)).toBe(14.0);

      // At 250 USDT equity -> 35.00 USDT
      expect(manager.computeGridTicket(250.0)).toBe(35.0);

      // Small account floor at 5.0 USDT minNotional
      expect(manager.computeGridTicket(20.0)).toBe(5.0);
    });

    it('computes daily circuit breaker loss limit ceiling', () => {
      // For DayStart <= 100 USDT, strictly enforces 12.0 USDT floor
      expect(manager.computeDailyLossLimit(100.0)).toBe(12.0);
      expect(manager.computeDailyLossLimit(50.0)).toBe(12.0);
      expect(manager.computeDailyLossLimit(33.29)).toBe(12.0);

      // As equity compounds beyond 100 USDT, scales as 12% of equity
      expect(manager.computeDailyLossLimit(200.0)).toBe(24.0);
      expect(manager.computeDailyLossLimit(500.0)).toBe(60.0);
      expect(manager.computeDailyLossLimit(800.0)).toBe(96.0);
    });

    it('generates a complete portfolio allocation snapshot and enforces max leverage <= 0.90', () => {
      const snap100 = manager.getAllocationSnapshot(100.0);
      expect(snap100.momentumAllocUsd).toBe(24.0);
      expect(snap100.btcGridTicketUsd).toBe(14.0);
      expect(snap100.dailyLossLimitUsd).toBe(12.0);
      // 2 * 24u + 3 * 14u = 48u + 42u = 90.00u (90% exposure)
      expect(snap100.totalMaxExposureUsd).toBe(90.0);
      expect(snap100.cashBufferUsd).toBe(10.0);
      expect(snap100.maxLeverage).toBe(0.9);

      const snap400 = manager.getAllocationSnapshot(400.0);
      expect(snap400.momentumAllocUsd).toBe(96.0);
      expect(snap400.btcGridTicketUsd).toBe(56.0);
      expect(snap400.dailyLossLimitUsd).toBe(48.0);
      expect(snap400.totalMaxExposureUsd).toBe(360.0);
      expect(snap400.cashBufferUsd).toBe(40.0);
      expect(snap400.maxLeverage).toBe(0.9);
    });

    it('validates portfolio exposure guardrails against over-leveraging', () => {
      const validSafe = manager.validateExposure(100.0, 90.0);
      expect(validSafe.isSafe).toBe(true);
      expect(validSafe.currentExposurePct).toBe(90.0);

      const validExcessive = manager.validateExposure(100.0, 150.0);
      expect(validExcessive.isSafe).toBe(false);
      expect(validExcessive.reason).toContain('exceeds safety threshold');
    });
  });

  describe('Part 2: VolatilityGridController', () => {
    const controller = new VolatilityGridController();

    // Generate mock candles with a specific daily volatility
    const createMockCandles = (basePrice: number, dailyVolPct: number, count = 20): CandleData[] => {
      const candles: CandleData[] = [];
      let price = basePrice;
      for (let i = 0; i < count; i++) {
        const spread = price * dailyVolPct;
        candles.push({
          high: price + spread / 2,
          low: price - spread / 2,
          close: price,
        });
        price += (i % 2 === 0 ? 1 : -1) * (spread * 0.2);
      }
      return candles;
    };

    it('computes 14-day ATR accurately from daily candles', () => {
      // BTC around 60,000 with 2.0% daily range (spread = 1,200)
      const candles = createMockCandles(60_000, 0.02, 20);
      const { atr14, atr14Pct } = controller.computeAtr14(candles);

      expect(atr14).toBeGreaterThan(1000);
      expect(atr14).toBeLessThan(1400);
      expect(atr14Pct).toBeCloseTo(0.02, 2);
    });

    it('adjusts grid spacing and take profit dynamically under normal volatility', () => {
      const normalCandles = createMockCandles(60_000, BASELINE_ATR_PCT, 20);
      const params = controller.computeGridParams(normalCandles);

      expect(params.volMultiplier).toBeCloseTo(1.0, 1);
      expect(params.gridStepPct).toBeCloseTo(BASE_STEP_PCT, 3);
      expect(params.gridTpPct).toBeCloseTo(BASE_TP_PCT, 3);
      expect(params.regime).toBe('normal_volatility');
    });

    it('tightens grid steps in low volatility regime to increase capital turnover', () => {
      // 0.8% low daily volatility
      const quietCandles = createMockCandles(60_000, 0.008, 20);
      const params = controller.computeGridParams(quietCandles);

      expect(params.volMultiplier).toBe(0.8); // Min clamp
      expect(params.gridStepPct).toBe(0.016); // Tightened dip step
      expect(params.gridTpPct).toBe(0.028);   // Quick take profit
      expect(params.regime).toBe('low_volatility');
    });

    it('widens grid steps in high volatility regime to catch deep dips safely', () => {
      // 4.5% high daily volatility (market turmoil)
      const wildCandles = createMockCandles(60_000, 0.045, 20);
      const params = controller.computeGridParams(wildCandles);

      expect(params.volMultiplier).toBe(1.5); // Max clamp
      expect(params.gridStepPct).toBe(0.030); // Expanded dip step
      expect(params.gridTpPct).toBe(0.050);   // Max clamped 5% take profit
      expect(params.crashGatePct).toBe(0.090); // 9% crash gate
      expect(params.regime).toBe('high_volatility');
    });
  });

  describe('Part 3: Telegram Interactive Notice Formatters for Phase 5', () => {
    const mockState: HybridLiveState = {
      policyId: 'PHASE2_HYBRID_MOM50_BTCGRID45_SL12_V1',
      status: 'active',
      lastObservedAt: '2026-10-28T04:40:00.000Z',
      accountEquity: 125.50,
      availableBalance: 85.00,
      dayStartEquity: 120.00,
      currentDayPnl: 5.50,
      worstDayPnl: 0,
      breakerLatched: false,
      positions: {},
      btcGridLevels: [{ entryPrice: 65000, qty: 0.00025, tpPrice: 67275 }],
      dynamicCompounding: {
        momentumAllocUsd: 30.12,
        btcGridTicketUsd: 17.57,
        dailyLossLimitUsd: 14.40,
        targetMomentumPct: 0.24,
        targetGridTicketPct: 0.14,
      },
      volatilityGrid: {
        atr14: 1250,
        atr14Pct: 1.92,
        volMultiplier: 0.96,
        gridStepPct: 0.0192,
        gridTpPct: 0.0336,
        crashGatePct: 0.0576,
        regime: 'normal_volatility',
      },
    };

    it('formats /compounding command with dynamic allocation breakdown', () => {
      const res = formatHybridCommandResponse('/compounding', mockState);
      expect(res).toContain('LÃI KÉP ĐỘNG — DYNAMIC COMPOUNDING (PHASE 5)');
      expect(res).toContain('125,50 USDT');
      expect(res).toContain('30,12 USDT');
      expect(res).toContain('24%');
      expect(res).toContain('17,57 USDT');
      expect(res).toContain('14%');
      expect(res).toContain('14,40 USDT');
    });

    it('formats /grid command with ATR-14 volatility grid details', () => {
      const res = formatHybridCommandResponse('/grid', mockState);
      expect(res).toContain('LƯỚI BIẾN ĐỘNG BTC (PHASE 5 ATR-14 VOLATILITY GRID)');
      expect(res).toContain('$1250');
      expect(res).toContain('1.92%');
      expect(res).toContain('1.92% mỗi tầng');
      expect(res).toContain('+3.36%');
      expect(res).toContain('1/3 tầng');
    });

    it('includes Phase 5 commands in /help listing', () => {
      const res = formatHybridCommandResponse('/help', mockState);
      expect(res).toContain('/compounding');
      expect(res).toContain('/grid');
    });
  });
});

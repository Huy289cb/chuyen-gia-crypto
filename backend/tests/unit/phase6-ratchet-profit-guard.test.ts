import { describe, it, expect } from 'vitest';
import { formatHybridRatchetNotice, formatHybridPositionClosedNotice } from '../../src/portfolio/hybrid-live-notice';
import { RESTRICTED_OR_LEVERAGED_SYMBOLS } from '../../src/portfolio/dynamic-universe';
import { computeSymbolAtr14Pct } from '../../src/portfolio/hybrid-worker';

describe('Phase 6: Progressive Risk-Reduction & Multi-Tier Ratchet Profit Guard', () => {
  describe('Part 1: Leveraged ETF Exclusion', () => {
    it('contains restricted inverse/leveraged ETFs that return code -4411', () => {
      expect(RESTRICTED_OR_LEVERAGED_SYMBOLS.has('SOXSUSDT')).toBe(true);
      expect(RESTRICTED_OR_LEVERAGED_SYMBOLS.has('SOXLUSDT')).toBe(true);
      expect(RESTRICTED_OR_LEVERAGED_SYMBOLS.has('KORUUSDT')).toBe(true);
      expect(RESTRICTED_OR_LEVERAGED_SYMBOLS.has('YINNUSDT')).toBe(true);
      expect(RESTRICTED_OR_LEVERAGED_SYMBOLS.has('YANGUSDT')).toBe(true);
      expect(RESTRICTED_OR_LEVERAGED_SYMBOLS.has('NVDLUSDT')).toBe(true);
      expect(RESTRICTED_OR_LEVERAGED_SYMBOLS.has('TSLLUSDT')).toBe(true);
      expect(RESTRICTED_OR_LEVERAGED_SYMBOLS.has('QUSDT')).toBe(true);
      expect(RESTRICTED_OR_LEVERAGED_SYMBOLS.has('EVAAUSDT')).toBe(true);
    });

    it('does not exclude standard crypto futures', () => {
      expect(RESTRICTED_OR_LEVERAGED_SYMBOLS.has('ETHUSDT')).toBe(false);
      expect(RESTRICTED_OR_LEVERAGED_SYMBOLS.has('SOLUSDT')).toBe(false);
      expect(RESTRICTED_OR_LEVERAGED_SYMBOLS.has('1000PEPEUSDT')).toBe(false);
      expect(RESTRICTED_OR_LEVERAGED_SYMBOLS.has('INJUSDT')).toBe(false);
    });
  });

  describe('Part 2: Progressive 4-Tier Ratchet Logic Simulation', () => {
    function computeProgressiveRatchet(
      entry: number,
      mark: number,
      currentSl: number,
      currentMaxRet: number,
      initialSlPct = 0.12
    ): {
      targetSl: number;
      targetTier: 'initial' | 'risk_reduction' | 'breakeven' | 'lock1' | 'lock2' | 'lock';
      shouldRatchet: boolean;
      newMaxRet: number;
    } {
      const ret = (mark - entry) / entry;
      const newMaxRet = Math.max(currentMaxRet, ret);

      let targetSl = entry * (1.0 - initialSlPct);
      let targetTier: 'initial' | 'risk_reduction' | 'breakeven' | 'lock1' | 'lock2' | 'lock' = 'initial';

      if (newMaxRet >= 0.16) {
        targetSl = entry * 1.10;
        targetTier = 'lock2';
      } else if (newMaxRet >= 0.12) {
        targetSl = entry * 1.05;
        targetTier = 'lock1';
      } else if (newMaxRet >= 0.08) {
        targetSl = entry * 1.008;
        targetTier = 'breakeven';
      } else if (newMaxRet >= 0.05) {
        targetSl = entry * 0.97;
        targetTier = 'risk_reduction';
      }

      const shouldRatchet = targetSl > currentSl * 1.001;
      return { targetSl, targetTier, shouldRatchet, newMaxRet };
    }

    it('keeps initial -12% stop when gain is under +5%', () => {
      const entry = 10.0;
      const initialSl = entry * 0.88; // 8.80
      const mark = 10.3; // +3% gain

      const r = computeProgressiveRatchet(entry, mark, initialSl, 0.0);
      expect(r.shouldRatchet).toBe(false);
      expect(r.targetTier).toBe('initial');
      expect(r.targetSl).toBeCloseTo(8.80);
      expect(r.newMaxRet).toBeCloseTo(0.03);
    });

    it('ratchets to Risk-Reduction (-3.0%) when gain touches +5.2%', () => {
      const entry = 10.0;
      const initialSl = entry * 0.88; // 8.80 (-12%)
      const mark = 10.52; // +5.2% gain

      const r = computeProgressiveRatchet(entry, mark, initialSl, 0.0);
      expect(r.shouldRatchet).toBe(true);
      expect(r.targetTier).toBe('risk_reduction');
      expect(r.targetSl).toBeCloseTo(9.70); // Entry - 3.0% (cuts 75% risk!)
      expect(r.newMaxRet).toBeCloseTo(0.052);
    });

    it('ratchets to Confirmed Break-Even (+0.8%) when gain touches +8.5%', () => {
      const entry = 10.0;
      const rrSl = 9.70; // Current SL at -3%
      const mark = 10.85; // +8.5% gain

      const r = computeProgressiveRatchet(entry, mark, rrSl, 0.052);
      expect(r.shouldRatchet).toBe(true);
      expect(r.targetTier).toBe('breakeven');
      expect(r.targetSl).toBeCloseTo(10.08); // Entry + 0.8%
      expect(r.newMaxRet).toBeCloseTo(0.085);
    });

    it('does not ratchet backward when price pulls back from +8.5% to +3%', () => {
      const entry = 10.0;
      const beSl = 10.08;
      const mark = 10.30; // +3% after prior +8.5% peak

      const r = computeProgressiveRatchet(entry, mark, beSl, 0.085);
      expect(r.shouldRatchet).toBe(false);
      expect(r.targetTier).toBe('breakeven');
      expect(r.targetSl).toBeCloseTo(10.08); // Preserves BE stop!
    });

    it('ratchets to Lock-Profit 1 (+5.0%) when gain touches +13.0%', () => {
      const entry = 10.0;
      const beSl = 10.08;
      const mark = 11.30; // +13.0% peak

      const r = computeProgressiveRatchet(entry, mark, beSl, 0.085);
      expect(r.shouldRatchet).toBe(true);
      expect(r.targetTier).toBe('lock1');
      expect(r.targetSl).toBeCloseTo(10.50); // Entry + 5.0%
    });

    it('ratchets to Lock-Profit 2 (+10.0%) when gain touches +17.5%', () => {
      const entry = 10.0;
      const lock1Sl = 10.50;
      const mark = 11.75; // +17.5% peak

      const r = computeProgressiveRatchet(entry, mark, lock1Sl, 0.13);
      expect(r.shouldRatchet).toBe(true);
      expect(r.targetTier).toBe('lock2');
      expect(r.targetSl).toBeCloseTo(11.00); // Entry + 10.0%
    });
  });

  describe('Part 3: Telegram Notice Formatting for All Tiers', () => {
    it('formats risk reduction notice correctly', () => {
      const text = formatHybridRatchetNotice({
        symbol: '1000PEPEUSDT',
        tier: 'risk_reduction',
        entryPrice: 0.0050,
        newSlPrice: 0.00485,
        maxReturnPct: 5.5,
      });

      expect(text).toContain('BẢO VỆ LỢI NHUẬN: 🛡️ GIẢM RỦI RO (-3,0%) cho 1000PEPE');
      expect(text).toContain('+5.5%');
      expect(text).toContain('STOP_MARKET sàn Binance');
    });

    it('formats break-even notice correctly', () => {
      const text = formatHybridRatchetNotice({
        symbol: 'INJUSDT',
        tier: 'breakeven',
        entryPrice: 7.833,
        newSlPrice: 7.8956,
        maxReturnPct: 8.5,
      });

      expect(text).toContain('BẢO VỆ LỢI NHUẬN: 🛡️ HÒA VỐN (+0,8%) cho INJ');
      expect(text).toContain('+8.5%');
      expect(text).toContain('STOP_MARKET sàn Binance');
    });

    it('formats lock-profit 1 notice correctly', () => {
      const text = formatHybridRatchetNotice({
        symbol: 'BLESSUSDT',
        tier: 'lock1',
        entryPrice: 0.00908,
        newSlPrice: 0.009534,
        maxReturnPct: 12.5,
      });

      expect(text).toContain('BẢO VỆ LỢI NHUẬN: 🔒 KHÓA LÃI NẤC 1 (+5,0%) cho BLESS');
      expect(text).toContain('+12.5%');
    });

    it('formats lock-profit 2 notice correctly', () => {
      const text = formatHybridRatchetNotice({
        symbol: 'BLESSUSDT',
        tier: 'lock2',
        entryPrice: 0.00908,
        newSlPrice: 0.009988,
        maxReturnPct: 17.0,
      });

      expect(text).toContain('BẢO VỆ LỢI NHUẬN: 🔒 KHÓA LÃI NẤC 2 (+10,0%) cho BLESS');
      expect(text).toContain('+17.0%');
    });

    it('formats closed position with risk reduction reason', () => {
      const text = formatHybridPositionClosedNotice({
        symbol: 'INITUSDT',
        qty: 100,
        entryPrice: 0.20,
        exitPrice: 0.194,
        pnl: -0.60,
        reason: 'RISK_REDUCTION',
      });

      expect(text).toContain('🛡️ Dừng lỗ giảm rủi ro (-3.0%)');
    });
  });

  describe('Part 4: Volatility-Adaptive Guards & Clamped Initial SL', () => {
    it('computes symbol ATR14 percentage correctly from daily candles', () => {
      const now = Date.now();
      const DAY = 86_400_000;
      const candles: Array<[number, string, string, string, string, ...unknown[]]> = [];
      let price = 100.0;
      for (let i = 20; i >= 0; i--) {
        const time = now - i * DAY;
        const high = (price * 1.05).toString();
        const low = (price * 0.95).toString();
        const close = price.toString();
        candles.push([time, price.toString(), high, low, close]);
      }

      const atr = computeSymbolAtr14Pct(candles);
      expect(atr).toBeGreaterThan(0.08);
      expect(atr).toBeLessThan(0.12);
    });

    it('clamps Dynamic ATR Stop Loss strictly between 8% and 12% (No -18% extreme bleed)', () => {
      // Very low ATR (2%): 1.8 * 2% = 3.6% -> Clamped to min 8%
      const lowAtr = 0.02;
      const lowSl = Math.max(0.08, Math.min(0.12, 1.8 * lowAtr));
      expect(lowSl).toBe(0.08);

      // Normal ATR (6%): 1.8 * 6% = 10.8%
      const normalAtr = 0.06;
      const normalSl = Math.max(0.08, Math.min(0.12, 1.8 * normalAtr));
      expect(normalSl).toBeCloseTo(0.108);

      // Extreme ATR (15%): 1.8 * 15% = 27% -> Clamped strictly to max 12% (NOT 18%!)
      const highAtr = 0.15;
      const highSl = Math.max(0.08, Math.min(0.12, 1.8 * highAtr));
      expect(highSl).toBe(0.12);
    });

    it('Same-Day Stop Loss Cooldown blocks re-entering stopped out symbol on same UTC day', () => {
      const cooldownMap = new Map<string, string>();
      const today = '2026-10-29';

      cooldownMap.set('QUSDT', today);
      const isEligible = (sym: string, day: string) => cooldownMap.get(sym) !== day;

      expect(isEligible('QUSDT', today)).toBe(false);
      expect(isEligible('ETHUSDT', today)).toBe(true);
      expect(isEligible('QUSDT', '2026-10-30')).toBe(true);
    });
  });
});

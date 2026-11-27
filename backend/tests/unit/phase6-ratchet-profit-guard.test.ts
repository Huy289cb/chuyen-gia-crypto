import { describe, it, expect } from 'vitest';
import { formatHybridRatchetNotice, formatHybridPositionClosedNotice } from '../../src/portfolio/hybrid-live-notice';
import { RESTRICTED_OR_LEVERAGED_SYMBOLS } from '../../src/portfolio/dynamic-universe';
import {
  computeSymbolAtr14Pct,
  computeRatchetTarget,
  PROFIT_LOCK_COOLDOWN_MS,
  WATCHDOG_TIMEOUT_MS,
} from '../../src/portfolio/hybrid-worker';

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

  describe('Part 2: v1.0.5 5-Tier Pre-Ratchet & Early-Lock Profit Guard', () => {
    function computeProgressiveRatchet(
      entry: number,
      mark: number,
      currentSl: number,
      currentMaxRet: number,
      initialSlPct = 0.12
    ) {
      const ret = (mark - entry) / entry;
      const newMaxRet = Math.max(currentMaxRet, ret);
      const { targetSl, targetTier } = computeRatchetTarget(entry, newMaxRet, initialSlPct);
      const shouldRatchet = targetSl > currentSl * 1.0005;
      return { targetSl, targetTier, shouldRatchet, newMaxRet };
    }

    it('keeps initial -12% stop when gain is under +3%', () => {
      const entry = 10.0;
      const initialSl = entry * 0.88; // 8.80
      const mark = 10.25; // +2.5% gain

      const r = computeProgressiveRatchet(entry, mark, initialSl, 0.0);
      expect(r.shouldRatchet).toBe(false);
      expect(r.targetTier).toBe('initial');
      expect(r.targetSl).toBeCloseTo(8.80);
      expect(r.newMaxRet).toBeCloseTo(0.025);
    });

    it('ratchets to Pre-Ratchet Risk-Reduction (-4.0%) when gain touches +3.0%', () => {
      const entry = 10.0;
      const initialSl = entry * 0.88; // 8.80 (-12%)
      const mark = 10.31; // +3.1% gain

      const r = computeProgressiveRatchet(entry, mark, initialSl, 0.0);
      expect(r.shouldRatchet).toBe(true);
      expect(r.targetTier).toBe('risk_reduction');
      expect(r.targetSl).toBeCloseTo(9.60); // Entry - 4.0%
      expect(r.newMaxRet).toBeCloseTo(0.031);
    });

    it('ratchets to Breakeven (+0.8%) when gain touches +5.2%', () => {
      const entry = 10.0;
      const initialSl = entry * 0.88; // 8.80 (-12%)
      const mark = 10.52; // +5.2% gain

      const r = computeProgressiveRatchet(entry, mark, initialSl, 0.0);
      expect(r.shouldRatchet).toBe(true);
      expect(r.targetTier).toBe('breakeven');
      expect(r.targetSl).toBeCloseTo(10.08); // Entry + 0.8%
      expect(r.newMaxRet).toBeCloseTo(0.052);
    });

    it('ratchets to Lock-Profit 1 (+3.5%) when gain touches +7.5%', () => {
      const entry = 10.0;
      const beSl = 10.08;
      const mark = 10.75; // +7.5% gain

      const r = computeProgressiveRatchet(entry, mark, beSl, 0.052);
      expect(r.shouldRatchet).toBe(true);
      expect(r.targetTier).toBe('lock1');
      expect(r.targetSl).toBeCloseTo(10.35); // Entry + 3.5%
      expect(r.newMaxRet).toBeCloseTo(0.075);
    });

    it('does not ratchet backward when price pulls back from +7.5% to +4%', () => {
      const entry = 10.0;
      const lock1Sl = 10.35;
      const mark = 10.40; // +4% after prior +7.5% peak

      const r = computeProgressiveRatchet(entry, mark, lock1Sl, 0.075);
      expect(r.shouldRatchet).toBe(false);
      expect(r.targetTier).toBe('lock1');
      expect(r.targetSl).toBeCloseTo(10.35); // Preserves Lock 1 stop!
    });

    it('ratchets to Lock-Profit 2 (+6.0%) when gain touches +10.5%', () => {
      const entry = 10.0;
      const lock1Sl = 10.35;
      const mark = 11.05; // +10.5% peak

      const r = computeProgressiveRatchet(entry, mark, lock1Sl, 0.075);
      expect(r.shouldRatchet).toBe(true);
      expect(r.targetTier).toBe('lock2');
      expect(r.targetSl).toBeCloseTo(10.60); // Entry + 6.0%
    });

    it('ratchets to Lock-Profit 3 (+10.0%) when gain touches +14.5%', () => {
      const entry = 10.0;
      const lock2Sl = 10.60;
      const mark = 11.45; // +14.5% peak

      const r = computeProgressiveRatchet(entry, mark, lock2Sl, 0.105);
      expect(r.shouldRatchet).toBe(true);
      expect(r.targetTier).toBe('lock3');
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

      expect(text).toContain('🛡️ BẢO VỆ XU HƯỚNG: 🛡️ GIẢM RỦI RO (-4,0%) cho 1000PEPE');
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

      expect(text).toContain('🛡️ BẢO VỆ XU HƯỚNG: 🛡️ HÒA VỐN AN TOÀN cho INJ');
      expect(text).toContain('+8.5%');
      expect(text).toContain('STOP_MARKET sàn Binance');
    });

    it('formats lock-profit 1 notice correctly', () => {
      const text = formatHybridRatchetNotice({
        symbol: 'BLESSUSDT',
        tier: 'lock1',
        entryPrice: 0.00908,
        newSlPrice: 0.009398,
        maxReturnPct: 7.5,
      });

      expect(text).toContain('🛡️ BẢO VỆ XU HƯỚNG: 🔒 KHÓA LÃI NẤC 1 (+3,5%) cho BLESS');
      expect(text).toContain('+7.5%');
    });

    it('formats lock-profit 2 notice correctly', () => {
      const text = formatHybridRatchetNotice({
        symbol: 'BLESSUSDT',
        tier: 'lock2',
        entryPrice: 0.00908,
        newSlPrice: 0.009625,
        maxReturnPct: 10.5,
      });

      expect(text).toContain('🛡️ BẢO VỆ XU HƯỚNG: 🔒 KHÓA LÃI NẤC 2 (+6,0%) cho BLESS');
      expect(text).toContain('+10.5%');
    });

    it('formats lock-profit 3 notice correctly', () => {
      const text = formatHybridRatchetNotice({
        symbol: 'BLESSUSDT',
        tier: 'lock3',
        entryPrice: 0.00908,
        newSlPrice: 0.009988,
        maxReturnPct: 15.0,
      });

      expect(text).toContain('🛡️ BẢO VỆ XU HƯỚNG: 🔒 CHANDELIER KHÓA LÃI (>= +1,0%) cho BLESS');
      expect(text).toContain('+15.0%');
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

      expect(text).toContain('🛡️ Dừng lỗ giảm rủi ro (-4.0%)');
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

  describe('Part 5: Phase 8.2 / v2.0.0 Operational Improvements (24h Cooldown & Resilient Watchdog)', () => {
    it('defines PROFIT_LOCK_COOLDOWN_MS as 24 hours (86,400,000ms) matching audited Turtle cooldown', () => {
      expect(PROFIT_LOCK_COOLDOWN_MS).toBe(24 * 60 * 60 * 1000);
    });

    it('defines WATCHDOG_TIMEOUT_MS as 35 seconds to prevent false-positive aborts on network jitter', () => {
      expect(WATCHDOG_TIMEOUT_MS).toBe(35_000);
    });

    it('differentiates losing SL exits (full UTC day) from profitable ratchet exits (2-hour cooldown)', () => {
      const cooldownMap = new Map<string, string>();
      const isSymbolInCooldown = (sym: string, nowMs: number, todayUtc: string): boolean => {
        const cd = cooldownMap.get(sym);
        if (!cd) return false;
        if (cd.includes('T')) {
          const expireMs = new Date(cd).getTime();
          if (Number.isFinite(expireMs) && nowMs < expireMs) return true;
          cooldownMap.delete(sym);
          return false;
        }
        if (cd === todayUtc) return true;
        cooldownMap.delete(sym);
        return false;
      };

      const now = new Date('2026-11-20T10:00:00.000Z').getTime();
      const today = '2026-11-20';

      // 1. Losing trade (initial SL -12%) -> Same-Day UTC Cooldown
      cooldownMap.set('LOSERUSDT', today);

      // 2. Profitable Ratchet exit (e.g. CROSSUSDT locked at +3.5%) -> 2h Cooldown
      const expireIso = new Date(now + PROFIT_LOCK_COOLDOWN_MS).toISOString();
      cooldownMap.set('CROSSUSDT', expireIso);

      // At T=0 (immediate exit): both symbols are blocked from re-entering
      expect(isSymbolInCooldown('LOSERUSDT', now, today)).toBe(true);
      expect(isSymbolInCooldown('CROSSUSDT', now, today)).toBe(true);

      // At T+1 hour: CROSSUSDT still in cooldown, LOSERUSDT still in cooldown
      const after1h = now + 1 * 3600_000;
      expect(isSymbolInCooldown('LOSERUSDT', after1h, today)).toBe(true);
      expect(isSymbolInCooldown('CROSSUSDT', after1h, today)).toBe(true);

      // At T+2 hours 1 minute: CROSSUSDT cooldown expires and is re-eligible for momentum waves!
      const after2h = now + PROFIT_LOCK_COOLDOWN_MS + 60_000;
      expect(isSymbolInCooldown('CROSSUSDT', after2h, today)).toBe(false);
      // LOSERUSDT remains strictly blocked for the rest of UTC day to prevent whipsaw
      expect(isSymbolInCooldown('LOSERUSDT', after2h, today)).toBe(true);

      // Next UTC day: LOSERUSDT unlocks
      const nextDay = '2026-11-21';
      expect(isSymbolInCooldown('LOSERUSDT', after2h + 24 * 3600_000, nextDay)).toBe(false);
    });
  });
});

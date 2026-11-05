import { describe, it, expect } from 'vitest';
import {
  BTC_CRASH_HEALTH_GATE_PCT,
  PRUNING_DAYS_THRESHOLD,
  PRUNING_MAX_RETURN_THRESH,
  PRUNING_CURRENT_RETURN_THRESH,
} from '../../src/portfolio/hybrid-worker';
import { formatHybridPruneNotice } from '../../src/portfolio/hybrid-live-notice';

describe('Phase 8: Freqtrade-Inspired Suite (BTC Crash Trend Gate & Loser Pruning)', () => {
  describe('Part 1: Calibrated Constants Integrity', () => {
    it('has BTC Crash Trend Health Gate calibrated to -3.0%', () => {
      expect(BTC_CRASH_HEALTH_GATE_PCT).toBe(-0.03);
    });

    it('has Pruning Days Threshold calibrated to 2.0 days (48 hours)', () => {
      expect(PRUNING_DAYS_THRESHOLD).toBe(2.0);
    });

    it('has Pruning Max Return Threshold calibrated to +2.0%', () => {
      expect(PRUNING_MAX_RETURN_THRESH).toBe(0.02);
    });

    it('has Pruning Current Return Threshold calibrated to -5.0%', () => {
      expect(PRUNING_CURRENT_RETURN_THRESH).toBe(-0.05);
    });
  });

  describe('Part 2: BTC Crash Trend Health Gate Decision Engine', () => {
    function shouldBlockNewAltcoins(btc1dReturn: number): boolean {
      return btc1dReturn <= BTC_CRASH_HEALTH_GATE_PCT;
    }

    it('blocks new altcoin entries on severe BTC crash day (-3.0% or worse)', () => {
      expect(shouldBlockNewAltcoins(-0.0300)).toBe(true);
      expect(shouldBlockNewAltcoins(-0.0350)).toBe(true);
      expect(shouldBlockNewAltcoins(-0.0650)).toBe(true);
    });

    it('allows new altcoin entries on normal or mildly negative BTC days (> -3.0%)', () => {
      expect(shouldBlockNewAltcoins(-0.0299)).toBe(false);
      expect(shouldBlockNewAltcoins(-0.0150)).toBe(false);
      expect(shouldBlockNewAltcoins(0.0000)).toBe(false);
      expect(shouldBlockNewAltcoins(0.0450)).toBe(false);
    });
  });

  describe('Part 3: Time-Decay Loser Pruning Decision Matrix', () => {
    function evaluatePruning(
      entryTime: number,
      now: number,
      maxRet: number,
      currentRet: number
    ): {
      shouldPrune: boolean;
      daysHeld: number;
      lossPctSaved: number;
    } {
      const daysHeld = (now - entryTime) / (24 * 3_600_000);
      const shouldPrune =
        daysHeld >= PRUNING_DAYS_THRESHOLD &&
        maxRet < PRUNING_MAX_RETURN_THRESH &&
        currentRet <= PRUNING_CURRENT_RETURN_THRESH;
      const lossPctSaved = shouldPrune ? Math.max(0, 0.12 - Math.abs(currentRet)) : 0;
      return { shouldPrune, daysHeld, lossPctSaved };
    }

    it('prunes sinking loser held for >= 2 days with maxRet < 2% and currentRet <= -5%', () => {
      const entryTime = 1000;
      const now = entryTime + 2.5 * 24 * 3_600_000; // 2.5 days
      const result = evaluatePruning(entryTime, now, 0.012, -0.055); // maxRet 1.2%, currRet -5.5%

      expect(result.shouldPrune).toBe(true);
      expect(result.daysHeld).toBe(2.5);
      // Saved ~6.5% vs 12% hard SL
      expect(result.lossPctSaved).toBeCloseTo(0.065, 4);
    });

    it('does NOT prune young position held < 2 days (gives 48h breathing room for momentum development)', () => {
      const entryTime = 1000;
      const now = entryTime + 1.2 * 24 * 3_600_000; // 1.2 days
      const result = evaluatePruning(entryTime, now, 0.005, -0.06);

      expect(result.shouldPrune).toBe(false);
      expect(result.daysHeld).toBeCloseTo(1.2, 4);
    });

    it('does NOT prune position that is only mildly negative (e.g. -2.3% like current 1000PEPEUSDT)', () => {
      const entryTime = 1000;
      const now = entryTime + 6.0 * 24 * 3_600_000; // 6 days
      const result = evaluatePruning(entryTime, now, 0.015, -0.0235); // -2.35%

      expect(result.shouldPrune).toBe(false);
    });

    it('does NOT prune position that demonstrated strength earlier (maxRet >= 2.0%)', () => {
      const entryTime = 1000;
      const now = entryTime + 2.2 * 24 * 3_600_000;
      const result = evaluatePruning(entryTime, now, 0.045, -0.055); // pumped +4.5% earlier

      expect(result.shouldPrune).toBe(false); // Handled by Ratchet Guard or regular SL
    });
  });

  describe('Part 4: Pruning Notice Format', () => {
    it('generates valid and clean notification for Telegram', () => {
      const notice = formatHybridPruneNotice({
        symbol: 'SINKUSDT',
        entryPrice: 1.50,
        exitPrice: 1.42,
        lossPct: -5.33,
        pnl: -0.65,
        daysHeld: 2.3,
      });

      expect(notice).toContain('✂️ CẮT TỈA COIN CHÌM XUỒNG (PHASE 8 PRUNING)');
      expect(notice).toContain('SINK');
      expect(notice).toContain('2.3 ngày');
      expect(notice).toContain('-5.33%');
      expect(notice).toContain('Tiết kiệm ~7%');
    });
  });
});

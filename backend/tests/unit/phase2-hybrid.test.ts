import { describe, it, expect } from 'vitest';
import {
  PHASE2_HYBRID_POLICY,
  normalizePortfolioPaperPolicy,
  buildPhase2HybridConfig,
} from '../../src/portfolio/policy-registry';
import {
  buildPhase2HybridTargets,
  SOURCE_HYBRID_REVISION,
  HYBRID_POLICY_ID,
} from '../../src/portfolio/source-hybrid';
import { SOURCE_UNIVERSE } from '../../src/portfolio/source-momentum';
import type { DailyPriceRow } from '../../src/portfolio/types';

describe('Phase 2 Multi-Sleeve Hybrid Policy & Target Generator', () => {
  it('registers PHASE2_HYBRID_POLICY with 100u capital, 12u loss limit, 0.95 grossCap', () => {
    expect(PHASE2_HYBRID_POLICY.id).toBe('PHASE2_HYBRID_MOM50_BTCGRID45_SL12_V1');
    expect(PHASE2_HYBRID_POLICY.strategy).toBe('multi-sleeve-hybrid-v1');
    expect(PHASE2_HYBRID_POLICY.initialCash).toBe('100');
    expect(PHASE2_HYBRID_POLICY.dailyLossLimitUsd).toBe('12');
    expect(PHASE2_HYBRID_POLICY.grossCap).toBe('0.95'); // $50 momentum + $45 BTC grid
    expect(normalizePortfolioPaperPolicy('PHASE2_HYBRID_MOM50_BTCGRID45_SL12_V1')).toBe(HYBRID_POLICY_ID);
    expect(normalizePortfolioPaperPolicy('multi-sleeve-hybrid-v1')).toBe(HYBRID_POLICY_ID);
  });

  it('buildPhase2HybridConfig constructs valid configuration object', () => {
    const config = buildPhase2HybridConfig({
      BTCUSDT: { stepSize: '0.001', minQty: '0.001', minNotional: '5' },
    });
    expect(config.policyId).toBe(HYBRID_POLICY_ID);
    expect(config.strategy).toBe('multi-sleeve-hybrid-v1');
    expect(config.grossCap).toBe('0.95');
    expect(config.feeRate).toBe('0.0007');
    expect(config.initialCash).toBe('100');
    expect(config.dailyLossLimitUsd).toBe('12');
  });

  it('generates multi-sleeve targets with momentum top 2 and BTC grid dipping', () => {
    const DAY = 86_400_000;
    const executeAt = 100 * DAY;
    const labelTime = executeAt - DAY;
    const latestLabel = labelTime - DAY;
    const pastLabel = latestLabel - 14 * DAY;

    const baseCloses: Record<string, number> = {};
    for (const s of SOURCE_UNIVERSE) baseCloses[s] = 100.0;
    baseCloses['BTCUSDT'] = 60_000.0;

    const pastRow: DailyPriceRow = { openTimeMs: pastLabel, closes: { ...baseCloses } };

    // Build 14 days of history before latestLabel - DAY
    const rows: DailyPriceRow[] = [pastRow];
    for (let t = pastLabel + DAY; t <= latestLabel - 2 * DAY; t += DAY) {
      rows.push({ openTimeMs: t, closes: { ...baseCloses } });
    }

    // On latestLabel - DAY: yesterday BTC
    const yesterdayCloses = { ...baseCloses, BTCUSDT: 59_000.0 };
    rows.push({ openTimeMs: latestLabel - DAY, closes: yesterdayCloses });

    // On latestLabel: today
    const todayCloses = { ...baseCloses };
    todayCloses['SOLUSDT'] = 150.0;
    todayCloses['TIAUSDT'] = 135.0;
    todayCloses['BTCUSDT'] = 57_000.0; // 5% dip -> triggers level 2 (dip >= 4%)
    rows.push({ openTimeMs: latestLabel, closes: todayCloses });

    const targets = buildPhase2HybridTargets(rows, executeAt);

    // Sleeve 1: Top 2 momentum coins get 0.25 each ($25 each)
    expect(targets.weights['SOLUSDT']).toBe(0.25);
    expect(targets.weights['TIAUSDT']).toBe(0.25);

    // Sleeve 2: BTC gets grid level 2 weight = 2 * 0.15 = 0.30 ($30)
    expect(targets.weights['BTCUSDT']).toBe(0.30);

    // Total gross exposure = 0.25 + 0.25 + 0.30 = 0.80 <= 0.95
    const totalExposure = Object.values(targets.weights).reduce((a, b) => a + b, 0);
    expect(totalExposure).toBe(0.80);

    expect(targets.knownAtMs).toBe(labelTime);
    expect(targets.sourceId).toContain(SOURCE_HYBRID_REVISION);
    expect(targets.sourceId).toContain('SOLUSDT-TIAUSDT:btc_lvl2');
  });

  it('trips BTC Crash Gate when BTC drops > 6% in 1 day, freezing grid entries', () => {
    const DAY = 86_400_000;
    const executeAt = 100 * DAY;
    const labelTime = executeAt - DAY;
    const latestLabel = labelTime - DAY;
    const pastLabel = latestLabel - 14 * DAY;

    const baseCloses: Record<string, number> = {};
    for (const s of SOURCE_UNIVERSE) baseCloses[s] = 100.0;
    baseCloses['BTCUSDT'] = 60_000.0;

    const rows: DailyPriceRow[] = [{ openTimeMs: pastLabel, closes: { ...baseCloses } }];
    for (let t = pastLabel + DAY; t <= latestLabel - 2 * DAY; t += DAY) {
      rows.push({ openTimeMs: t, closes: { ...baseCloses } });
    }

    // Yesterday BTC was 60,000; Today BTC drops to 55,000 (-8.33% drop -> trips crash gate)
    rows.push({ openTimeMs: latestLabel - DAY, closes: { ...baseCloses, BTCUSDT: 60_000.0 } });

    const todayCloses = { ...baseCloses };
    todayCloses['SOLUSDT'] = 150.0;
    todayCloses['PEPEUSDT'] = 140.0;
    todayCloses['BTCUSDT'] = 55_000.0;
    rows.push({ openTimeMs: latestLabel, closes: todayCloses });

    const targets = buildPhase2HybridTargets(rows, executeAt);

    // Sleeve 1 still gets momentum
    expect(targets.weights['SOLUSDT']).toBe(0.25);

    // Sleeve 2 is FROZEN (0 BTC grid weight) because 1-day drop was -8.33% < -6.0%
    expect(targets.weights['BTCUSDT']).toBe(0);

    const meta = targets.metadata?._hybrid as any;
    expect(meta.sleeve2.crashGateTripped).toBe(true);
    expect(meta.sleeve2.activeLevels).toBe(0);
  });
});

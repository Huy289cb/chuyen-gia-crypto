import { describe, it, expect } from 'vitest';
import {
  MACRO_MOMENTUM_CALIBRATED_POLICY,
  normalizePortfolioPaperPolicy,
  buildMacroMomentumCalibratedConfig,
} from '../../src/portfolio/policy-registry';
import {
  buildMacroMomentumTargets,
  SOURCE_MACRO_MOMENTUM_REVISION,
} from '../../src/portfolio/source-macro-momentum';
import { SOURCE_UNIVERSE } from '../../src/portfolio/source-momentum';
import type { DailyPriceRow } from '../../src/portfolio/types';

describe('Macro Momentum Calibrated Policy', () => {
  it('registers MACRO_MOMENTUM_CALIBRATED_POLICY with 100u initial cash and 12u loss limit', () => {
    expect(MACRO_MOMENTUM_CALIBRATED_POLICY.id).toBe('MACRO_MOMENTUM_TOP2_ALLOC25_SL12_V1');
    expect(MACRO_MOMENTUM_CALIBRATED_POLICY.initialCash).toBe('100');
    expect(MACRO_MOMENTUM_CALIBRATED_POLICY.dailyLossLimitUsd).toBe('12');
    expect(MACRO_MOMENTUM_CALIBRATED_POLICY.grossCap).toBe('0.5'); // $25 x 2 = $50
    expect(normalizePortfolioPaperPolicy('MACRO_MOMENTUM_TOP2_ALLOC25_SL12_V1')).toBe('MACRO_MOMENTUM_TOP2_ALLOC25_SL12_V1');
    expect(normalizePortfolioPaperPolicy('macro-momentum-calibrated-v1')).toBe('MACRO_MOMENTUM_TOP2_ALLOC25_SL12_V1');
  });

  it('buildMacroMomentumCalibratedConfig builds valid configuration', () => {
    const config = buildMacroMomentumCalibratedConfig({
      BTCUSDT: { stepSize: '0.001', minQty: '0.001', minNotional: '5' },
    });
    expect(config.policyId).toBe('MACRO_MOMENTUM_TOP2_ALLOC25_SL12_V1');
    expect(config.strategy).toBe('macro-momentum-calibrated-v1');
    expect(config.feeRate).toBe('0.0007');
    expect(config.initialCash).toBe('100');
    expect(config.dailyLossLimitUsd).toBe('12');
  });

  it('generates targets selecting top 2 positive momentum coins with 0.25 weight each', () => {
    const DAY = 86_400_000;
    const executeAt = 100 * DAY;
    const labelTime = executeAt - DAY;
    const latestLabel = labelTime - DAY;
    const pastLabel = latestLabel - 14 * DAY;

    const baseCloses: Record<string, number> = {};
    for (const s of SOURCE_UNIVERSE) baseCloses[s] = 100.0;

    const pastRow: DailyPriceRow = { openTimeMs: pastLabel, closes: { ...baseCloses } };
    const latestCloses = { ...baseCloses };
    latestCloses['SOLUSDT'] = 150.0; // +50% momentum
    latestCloses['BNBUSDT'] = 130.0; // +30% momentum
    latestCloses['DOGEUSDT'] = 110.0; // +10% momentum
    latestCloses['ETHUSDT'] = 90.0; // -10% momentum

    const latestRow: DailyPriceRow = { openTimeMs: latestLabel, closes: latestCloses };

    const targets = buildMacroMomentumTargets([pastRow, latestRow], executeAt);
    expect(targets.weights['SOLUSDT']).toBe(0.25);
    expect(targets.weights['BNBUSDT']).toBe(0.25);
    expect(targets.weights['DOGEUSDT']).toBe(0.0);
    expect(targets.weights['ETHUSDT']).toBe(0.0);
    expect(targets.knownAtMs).toBe(labelTime);
    expect(targets.sourceId).toContain(SOURCE_MACRO_MOMENTUM_REVISION);
  });
});

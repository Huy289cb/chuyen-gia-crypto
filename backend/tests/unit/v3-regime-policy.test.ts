import { describe, expect, it } from 'vitest';
import {
  getRegimeTrendMinPct,
  regimeForGatePass,
  shouldBypassRegimeForBreakout,
} from '../../src/config/v3-regime-policy';

describe('v3-regime-policy', () => {
  it('1h trend threshold lower than legacy 0.15', () => {
    expect(getRegimeTrendMinPct('1h')).toBeLessThan(0.15);
  });

  it('only breakout grade A bypasses regime for gate', () => {
    process.env.V3_BREAKOUT_REGIME_BYPASS = 'true';
    expect(
      shouldBypassRegimeForBreakout('15m', 'breakout_volume', 'A')
    ).toBe(true);
    expect(
      shouldBypassRegimeForBreakout('15m', 'breakout_volume', 'B')
    ).toBe(false);
    expect(
      shouldBypassRegimeForBreakout('15m', 'liquidity_sweep_reclaim', 'A')
    ).toBe(false);
  });

  it('regimeForGatePass uses breakout bypass', () => {
    process.env.V3_BREAKOUT_REGIME_BYPASS = 'true';
    const gate = regimeForGatePass({
      timeframe: '15m',
      localRegime: 'range',
      playbookKey: 'breakout_volume',
      grade: 'A',
    });
    expect(gate).toBe('trend');
  });
});

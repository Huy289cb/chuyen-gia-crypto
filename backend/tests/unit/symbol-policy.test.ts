import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getCorrelationMaxExposureUsd,
  getEnabledSymbols,
  getSymbolMaxExposureUsd,
  getSymbolPolicy,
} from '../../src/config/symbol-policy';

const envKeys = [
  'ENABLED_SYMBOLS',
  'MAX_TOTAL_EXPOSURE_USD',
  'MAX_EXPOSURE_PCT_OF_EQUITY',
  'MIN_SL_DISTANCE_PERCENT',
  'MIN_SIGNAL_GRADE',
  'MIN_SIGNAL_CONFIDENCE',
  'SYMBOL_POLICY_BTC_MAX_EXPOSURE_USD',
  'SYMBOL_POLICY_BTC_MIN_SL_DISTANCE_PERCENT',
  'SYMBOL_POLICY_BTC_MIN_SIGNAL_GRADE',
  'SYMBOL_POLICY_BTC_MIN_SIGNAL_CONFIDENCE',
  'SYMBOL_POLICY_BTC_RISK_MULTIPLIER',
  'SYMBOL_POLICY_ETH_MAX_EXPOSURE_USD',
  'SYMBOL_POLICY_ETH_MIN_SL_DISTANCE_PERCENT',
  'SYMBOL_POLICY_ETH_MIN_SIGNAL_GRADE',
  'SYMBOL_POLICY_ETH_MIN_SIGNAL_CONFIDENCE',
  'SYMBOL_POLICY_ETH_RISK_MULTIPLIER',
  'SYMBOL_POLICY_ETH_ALLOWED_PLAYBOOKS',
  'CORRELATION_MAX_LONG_EXPOSURE_USD',
  'CORRELATION_MAX_SHORT_EXPOSURE_USD',
] as const;

const savedEnv = new Map<string, string | undefined>();

describe('symbol-policy', () => {
  beforeEach(() => {
    savedEnv.clear();
    for (const key of envKeys) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = savedEnv.get(key);
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('defaults to BTC when ENABLED_SYMBOLS is empty', () => {
    process.env.ENABLED_SYMBOLS = ' , ';
    expect(getEnabledSymbols()).toEqual(['BTC']);
  });

  it('normalizes and deduplicates enabled symbols', () => {
    process.env.ENABLED_SYMBOLS = 'btc, ETHUSDT, sol,btc';
    expect(getEnabledSymbols()).toEqual(['BTC', 'ETH', 'SOL']);
  });

  it('resolves per-symbol policy from SYMBOL_POLICY_* env vars', () => {
    process.env.MIN_SL_DISTANCE_PERCENT = '0.008';
    process.env.MIN_SIGNAL_GRADE = 'A';
    process.env.MIN_SIGNAL_CONFIDENCE = '0.75';
    process.env.SYMBOL_POLICY_ETH_MAX_EXPOSURE_USD = '1200';
    process.env.SYMBOL_POLICY_ETH_MIN_SL_DISTANCE_PERCENT = '0.012';
    process.env.SYMBOL_POLICY_ETH_MIN_SIGNAL_CONFIDENCE = '0.78';
    process.env.SYMBOL_POLICY_ETH_RISK_MULTIPLIER = '0.7';
    process.env.SYMBOL_POLICY_ETH_ALLOWED_PLAYBOOKS = 'liquidity_sweep_reclaim, breakout_volume';

    expect(getSymbolPolicy('ETHUSDT')).toMatchObject({
      symbol: 'ETH',
      maxExposureUsd: 1200,
      minSlDistancePercent: 0.012,
      minSignalGrade: 'A',
      minSignalConfidence: 0.78,
      riskMultiplier: 0.7,
      allowedPlaybooks: ['liquidity_sweep_reclaim', 'breakout_volume'],
    });
  });

  it('uses explicit symbol max exposure before percentage-of-equity fallback', () => {
    process.env.MAX_TOTAL_EXPOSURE_USD = '2000';
    process.env.MAX_EXPOSURE_PCT_OF_EQUITY = '0.1';
    process.env.SYMBOL_POLICY_ETH_MAX_EXPOSURE_USD = '1200';

    expect(getSymbolMaxExposureUsd('ETH', 5000)).toBe(1200);
    expect(getSymbolMaxExposureUsd('BTC', 5000)).toBe(500);
  });

  it('parses optional same-side correlation caps', () => {
    process.env.CORRELATION_MAX_LONG_EXPOSURE_USD = '2500';
    process.env.CORRELATION_MAX_SHORT_EXPOSURE_USD = 'bad';

    expect(getCorrelationMaxExposureUsd('long')).toBe(2500);
    expect(getCorrelationMaxExposureUsd('short')).toBeNull();
  });
});

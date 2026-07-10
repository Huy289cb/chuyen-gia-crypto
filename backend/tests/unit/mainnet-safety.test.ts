import { afterEach, describe, expect, it } from 'vitest';
import {
  assertBinanceMutationAllowed,
  getEffectiveMaxExposureUsd,
  getEffectiveRiskPerTradePercent,
  isBinanceMainnet,
  validateMainnetSafetyRequirements,
} from '../../src/config/mainnet-safety';

describe('mainnet-safety', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('detects mainnet from Binance base URL', () => {
    process.env.BINANCE_BASE_URL = 'https://fapi.binance.com';
    expect(isBinanceMainnet()).toBe(true);

    process.env.BINANCE_BASE_URL = 'https://demo-fapi.binance.com';
    expect(isBinanceMainnet()).toBe(false);
  });

  it('blocks mainnet trading mutations unless live trading is explicitly acknowledged', () => {
    process.env.BINANCE_BASE_URL = 'https://fapi.binance.com';
    delete process.env.MAINNET_LIVE_TRADING_ENABLED;
    delete process.env.MAINNET_TRADING_ACK;

    expect(() => assertBinanceMutationAllowed('POST', '/fapi/v1/order')).toThrow(
      'Mainnet trading mutation blocked'
    );

    process.env.MAINNET_LIVE_TRADING_ENABLED = 'true';
    process.env.MAINNET_TRADING_ACK = 'I_UNDERSTAND_REAL_MONEY';
    expect(() => assertBinanceMutationAllowed('POST', '/fapi/v1/order')).not.toThrow();
  });

  it('allows mainnet read requests in shadow mode', () => {
    process.env.BINANCE_BASE_URL = 'https://fapi.binance.com';
    expect(() => assertBinanceMutationAllowed('GET', '/fapi/v2/balance')).not.toThrow();
  });

  it('caps risk and exposure on mainnet', () => {
    process.env.BINANCE_BASE_URL = 'https://fapi.binance.com';
    process.env.MAINNET_MAX_TOTAL_EXPOSURE_USD = '50';
    process.env.MAINNET_MAX_RISK_PER_TRADE_PERCENT = '0.25';

    expect(getEffectiveMaxExposureUsd(2000)).toBe(50);
    expect(getEffectiveRiskPerTradePercent(0.5)).toBe(0.25);
  });

  it('reports unsafe live mainnet configuration', () => {
    process.env.BINANCE_ENABLED = 'true';
    process.env.BINANCE_BASE_URL = 'https://fapi.binance.com';
    process.env.MAINNET_LIVE_TRADING_ENABLED = 'true';
    process.env.MAINNET_TRADING_ACK = '';
    process.env.BINANCE_LEVERAGE = '20';
    process.env.MAX_TOTAL_EXPOSURE_USD = '2000';
    process.env.RISK_PER_TRADE_PERCENT = '0.5';

    const errors = validateMainnetSafetyRequirements();
    expect(errors.join('\n')).toContain('MAINNET_TRADING_ACK');
    expect(errors.join('\n')).toContain('BINANCE_LEVERAGE=20');
    expect(errors.join('\n')).toContain('MAX_TOTAL_EXPOSURE_USD=2000');
    expect(errors.join('\n')).toContain('RISK_PER_TRADE_PERCENT=0.5');
  });
});


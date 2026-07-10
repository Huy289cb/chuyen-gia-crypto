/**
 * Unit tests for Binance configuration (re-import per test — config is read at module load).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

async function loadBinanceConfig() {
  vi.resetModules();
  return import('../../src/config/binance.js');
}

describe('Binance Config', () => {
  beforeEach(() => {
    process.env.BINANCE_API_KEY = '';
    process.env.BINANCE_API_SECRET = '';
    process.env.BINANCE_ENABLED = 'false';
    process.env.BINANCE_SYMBOL = 'BTCUSDT';
    process.env.BINANCE_LEVERAGE = '1';
  });

  describe('binanceConfig object', () => {
    it('should have default symbol BTCUSDT', async () => {
      const { binanceConfig } = await loadBinanceConfig();
      expect(binanceConfig.symbol).toBe('BTCUSDT');
    });

    it('should have default leverage 1', async () => {
      const { binanceConfig } = await loadBinanceConfig();
      expect(binanceConfig.leverage).toBe(1);
    });

    it('should have rate limits configured', async () => {
      const { binanceConfig } = await loadBinanceConfig();
      expect(binanceConfig.rateLimits.requestWeight).toBe(2400);
      expect(binanceConfig.rateLimits.orderRate).toBe(1200);
    });
  });

  describe('validateConfig', () => {
    it('should return true when testnet is disabled', async () => {
      process.env.BINANCE_ENABLED = 'false';
      const { validateConfig } = await loadBinanceConfig();
      expect(validateConfig()).toBe(true);
    });

    it('should return false when enabled but API keys are missing', async () => {
      process.env.BINANCE_ENABLED = 'true';
      process.env.BINANCE_API_KEY = '';
      process.env.BINANCE_API_SECRET = '';
      const { validateConfig } = await loadBinanceConfig();
      expect(validateConfig()).toBe(false);
    });

    it('should return true when enabled with valid API keys', async () => {
      process.env.BINANCE_ENABLED = 'true';
      process.env.BINANCE_API_KEY = 'test_api_key';
      process.env.BINANCE_API_SECRET = 'test_secret_key';
      const { validateConfig } = await loadBinanceConfig();
      expect(validateConfig()).toBe(true);
    });
  });

  describe('getLeverage', () => {
    it('should return default leverage 1', async () => {
      process.env.BINANCE_LEVERAGE = '1';
      const { getLeverage } = await loadBinanceConfig();
      expect(getLeverage()).toBe(1);
    });

    it('should return custom leverage from env', async () => {
      process.env.BINANCE_LEVERAGE = '5';
      const { getLeverage } = await loadBinanceConfig();
      expect(getLeverage()).toBe(5);
    });
  });

  describe('getSymbol', () => {
    it('should return default symbol BTCUSDT', async () => {
      const { getSymbol } = await loadBinanceConfig();
      expect(getSymbol()).toBe('BTCUSDT');
    });

    it('should return custom symbol from env', async () => {
      process.env.BINANCE_SYMBOL = 'ETHUSDT';
      const { getSymbol } = await loadBinanceConfig();
      expect(getSymbol()).toBe('ETHUSDT');
    });
  });
});

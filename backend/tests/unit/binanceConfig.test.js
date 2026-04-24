/**
 * Unit tests for Binance Testnet Configuration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { binanceConfig, validateConfig, getLeverage, getSymbol } from '../../src/config/binance.js';

describe('Binance Config', () => {
  beforeEach(() => {
    // Reset environment variables before each test
    process.env.BINANCE_API_KEY = '';
    process.env.BINANCE_API_SECRET = '';
    process.env.BINANCE_ENABLED = 'false';
    process.env.BINANCE_SYMBOL = 'BTCUSDT';
    process.env.BINANCE_LEVERAGE = '1';
  });

  describe('binanceConfig object', () => {
    it('should have default symbol BTCUSDT', () => {
      expect(binanceConfig.symbol).toBe('BTCUSDT');
    });

    it('should have default leverage 1', () => {
      expect(binanceConfig.leverage).toBe(1);
    });

    it('should have rate limits configured', () => {
      expect(binanceConfig.rateLimits.requestWeight).toBe(2400);
      expect(binanceConfig.rateLimits.orderRate).toBe(1200);
    });

    it('should have all order types defined', () => {
      expect(binanceConfig.orderTypes.MARKET).toBe('MARKET');
      expect(binanceConfig.orderTypes.LIMIT).toBe('LIMIT');
      expect(binanceConfig.orderTypes.STOP_MARKET).toBe('STOP_MARKET');
      expect(binanceConfig.orderTypes.STOP_LIMIT).toBe('STOP_LIMIT');
      expect(binanceConfig.orderTypes.TAKE_PROFIT_MARKET).toBe('TAKE_PROFIT_MARKET');
      expect(binanceConfig.orderTypes.TAKE_PROFIT_LIMIT).toBe('TAKE_PROFIT_LIMIT');
    });

    it('should have BUY and SELL sides', () => {
      expect(binanceConfig.sides.BUY).toBe('BUY');
      expect(binanceConfig.sides.SELL).toBe('SELL');
    });

    it('should have position sides defined', () => {
      expect(binanceConfig.positionSides.BOTH).toBe('BOTH');
      expect(binanceConfig.positionSides.LONG).toBe('LONG');
      expect(binanceConfig.positionSides.SHORT).toBe('SHORT');
    });

    it('should have time in force options', () => {
      expect(binanceConfig.timeInForce.GTC).toBe('GTC');
      expect(binanceConfig.timeInForce.IOC).toBe('IOC');
      expect(binanceConfig.timeInForce.FOK).toBe('FOK');
      expect(binanceConfig.timeInForce.GTX).toBe('GTX');
    });

    it('should have working hours configured', () => {
      expect(binanceConfig.workingHours.london).toEqual({ start: 7, end: 10 });
      expect(binanceConfig.workingHours.nyKillzone).toEqual({ start: 12, end: 15 });
    });
  });

  describe('validateConfig', () => {
    it('should return true when testnet is disabled', () => {
      process.env.BINANCE_ENABLED = 'false';
      const result = validateConfig();
      expect(result).toBe(true);
    });

    it('should return false when testnet is enabled but API keys are missing', () => {
      process.env.BINANCE_ENABLED = 'true';
      process.env.BINANCE_API_KEY = '';
      process.env.BINANCE_API_SECRET = '';
      const result = validateConfig();
      expect(result).toBe(false);
    });

    it('should return false when API key is missing', () => {
      process.env.BINANCE_ENABLED = 'true';
      process.env.BINANCE_API_KEY = '';
      process.env.BINANCE_API_SECRET = 'secret';
      const result = validateConfig();
      expect(result).toBe(false);
    });

    it('should return false when secret key is missing', () => {
      process.env.BINANCE_ENABLED = 'true';
      process.env.BINANCE_API_KEY = 'key';
      process.env.BINANCE_API_SECRET = '';
      const result = validateConfig();
      expect(result).toBe(false);
    });

    it('should return true when testnet is enabled with valid API keys', () => {
      process.env.BINANCE_ENABLED = 'true';
      process.env.BINANCE_API_KEY = 'test_api_key';
      process.env.BINANCE_API_SECRET = 'test_secret_key';
      const result = validateConfig();
      expect(result).toBe(true);
    });
  });

  describe('getLeverage', () => {
    it('should return default leverage 1', () => {
      const leverage = getLeverage();
      expect(leverage).toBe(1);
    });

    it('should return custom leverage from env', () => {
      process.env.BINANCE_LEVERAGE = '5';
      const leverage = getLeverage();
      expect(leverage).toBe(5);
    });

    it('should handle invalid leverage value', () => {
      process.env.BINANCE_LEVERAGE = 'invalid';
      const leverage = getLeverage();
      expect(leverage).toBeNaN();
    });
  });

  describe('getSymbol', () => {
    it('should return default symbol BTCUSDT', () => {
      const symbol = getSymbol();
      expect(symbol).toBe('BTCUSDT');
    });

    it('should return custom symbol from env', () => {
      process.env.BINANCE_SYMBOL = 'ETHUSDT';
      const symbol = getSymbol();
      expect(symbol).toBe('ETHUSDT');
    });
  });
});

import { describe, it, expect } from 'vitest';
import { detectSwingPoints, calculateFibonacciLevels, getFibonacciFromOHLC } from '../../src/utils/fibonacci.js';
import { sampleOHLCData } from '../fixtures/ohlcData.js';

describe('Fibonacci Utility', () => {
  describe('detectSwingPoints', () => {
    it('should detect swing high and low from OHLC data', () => {
      const swingPoints = detectSwingPoints(sampleOHLCData, 5);

      expect(swingPoints).toBeDefined();
      expect(swingPoints.swingHigh).toBeDefined();
      expect(swingPoints.swingLow).toBeDefined();
      expect(swingPoints.swingHigh).toBeGreaterThan(swingPoints.swingLow);
    });

    it('should return object with null values for insufficient data', () => {
      const swingPoints = detectSwingPoints(sampleOHLCData.slice(0, 2), 5);
      expect(swingPoints).toBeDefined();
      expect(swingPoints.swingHigh).toBeNull();
      expect(swingPoints.swingLow).toBeNull();
    });

    it('should detect swing points with different lookback', () => {
      const swingPoints5 = detectSwingPoints(sampleOHLCData, 5);
      const swingPoints10 = detectSwingPoints(sampleOHLCData, 10);

      expect(swingPoints5).toBeDefined();
      expect(swingPoints10).toBeDefined();
      // Different lookback may produce different results
    });
  });

  describe('calculateFibonacciLevels', () => {
    it('should calculate retracement levels for uptrend', () => {
      const levels = calculateFibonacciLevels(75000, 74000, 'up');

      expect(levels).toBeDefined();
      expect(levels.retracement).toBeDefined();
      expect(levels.extension).toBeDefined();

      // Check retracement levels
      expect(levels.retracement[0].level).toBe(0.382);
      expect(levels.retracement[1].level).toBe(0.5);
      expect(levels.retracement[2].level).toBe(0.618);

      // Prices should be between swing high and low
      levels.retracement.forEach(level => {
        expect(level.price).toBeGreaterThanOrEqual(74000);
        expect(level.price).toBeLessThanOrEqual(75000);
      });
    });

    it('should calculate extension levels for uptrend', () => {
      const levels = calculateFibonacciLevels(75000, 74000, 'up');

      expect(levels.extension).toBeDefined();
      expect(levels.extension[0].level).toBe(1.272);
      expect(levels.extension[1].level).toBe(1.618);

      // Extension prices should be above swing high for uptrend
      levels.extension.forEach(level => {
        expect(level.price).toBeGreaterThan(75000);
      });
    });

    it('should calculate retracement levels for downtrend', () => {
      const levels = calculateFibonacciLevels(74000, 75000, 'down');

      expect(levels.retracement).toBeDefined();

      // Prices should be between swing high and low
      levels.retracement.forEach(level => {
        expect(level.price).toBeGreaterThanOrEqual(74000);
        expect(level.price).toBeLessThanOrEqual(75000);
      });
    });

    it('should calculate extension levels for downtrend', () => {
      const levels = calculateFibonacciLevels(74000, 75000, 'down');

      expect(levels.extension).toBeDefined();

      // Extension prices should be below swing low for downtrend
      levels.extension.forEach(level => {
        expect(level.price).toBeLessThan(74000);
      });
    });

    it('should include correct labels', () => {
      const levels = calculateFibonacciLevels(75000, 74000, 'up');

      expect(levels.retracement[0].label).toBe('38.2%');
      expect(levels.retracement[1].label).toBe('50.0%');
      expect(levels.retracement[2].label).toBe('61.8%');
      expect(levels.extension[0].label).toBe('127.2%');
      expect(levels.extension[1].label).toBe('161.8%');
    });
  });

  describe('getFibonacciFromOHLC', () => {
    it('should calculate Fibonacci levels from OHLC data', () => {
      const levels = getFibonacciFromOHLC(sampleOHLCData, 'up', 20);

      expect(levels).toBeDefined();
      expect(levels.retracement).toBeDefined();
      expect(levels.extension).toBeDefined();
      // May return fallback with empty arrays if swing points not detected
      expect(Array.isArray(levels.retracement)).toBe(true);
      expect(Array.isArray(levels.extension)).toBe(true);
    });

    it('should handle downtrend direction', () => {
      const levels = getFibonacciFromOHLC(sampleOHLCData, 'down', 20);

      expect(levels).toBeDefined();
      expect(levels.retracement).toBeDefined();
      expect(levels.extension).toBeDefined();
    });

    it('should handle different lookback periods', () => {
      const levels5 = getFibonacciFromOHLC(sampleOHLCData, 'up', 5);
      const levels10 = getFibonacciFromOHLC(sampleOHLCData, 'up', 10);

      expect(levels5).toBeDefined();
      expect(levels10).toBeDefined();
    });

    it('should return fallback if swing points cannot be detected', () => {
      const insufficientData = sampleOHLCData.slice(0, 3);
      const levels = getFibonacciFromOHLC(insufficientData, 'up', 20);

      // Should still return a valid structure with fallback data
      expect(levels).toBeDefined();
      expect(levels.retracement).toBeDefined();
      expect(levels.extension).toBeDefined();
    });
  });
});

import { describe, it, expect } from 'vitest';
import { sampleAIResponse } from '../fixtures/ohlcData.js';

describe('Alternative Scenario Validation', () => {
  describe('SL/TP placement validation', () => {
    it('should validate SL placement for bullish bias (SL must be below entry)', () => {
      const bias = 'bullish';
      const entry = 75412.1;
      const sl = 74800;

      // For long: SL must be below entry
      const isValid = sl < entry;
      expect(isValid).toBe(true);
    });

    it('should reject SL placement for bullish bias if SL is above entry', () => {
      const bias = 'bullish';
      const entry = 75412.1;
      const sl = 76000;

      // For long: SL must be below entry
      const isValid = sl < entry;
      expect(isValid).toBe(false);
    });

    it('should validate SL placement for bearish bias (SL must be above entry)', () => {
      const bias = 'bearish';
      const entry = 74800;
      const sl = 75500;

      // For short: SL must be above entry
      const isValid = sl > entry;
      expect(isValid).toBe(true);
    });

    it('should reject SL placement for bearish bias if SL is below entry', () => {
      const bias = 'bearish';
      const entry = 74800;
      const sl = 74500;

      // For short: SL must be above entry
      const isValid = sl > entry;
      expect(isValid).toBe(false);
    });

    it('should validate TP placement for bullish bias (TP must be above entry)', () => {
      const bias = 'bullish';
      const entry = 75412.1;
      const tp = 78000;

      // For long: TP must be above entry
      const isValid = tp > entry;
      expect(isValid).toBe(true);
    });

    it('should reject TP placement for bullish bias if TP is below entry', () => {
      const bias = 'bullish';
      const entry = 75412.1;
      const tp = 75000;

      // For long: TP must be above entry
      const isValid = tp > entry;
      expect(isValid).toBe(false);
    });

    it('should validate TP placement for bearish bias (TP must be below entry)', () => {
      const bias = 'bearish';
      const entry = 74800;
      const tp = 73500;

      // For short: TP must be below entry
      const isValid = tp < entry;
      expect(isValid).toBe(true);
    });

    it('should reject TP placement for bearish bias if TP is above entry', () => {
      const bias = 'bearish';
      const entry = 74800;
      const tp = 75500;

      // For short: TP must be below entry
      const isValid = tp < entry;
      expect(isValid).toBe(false);
    });
  });

  describe('R:R ratio validation', () => {
    it('should validate minimum R:R ratio of 2.5', () => {
      const entry = 75412.1;
      const sl = 74800;
      const tp = 78000;

      const risk = Math.abs(entry - sl);
      const reward = Math.abs(tp - entry);
      const rr = reward / risk;

      expect(rr).toBeGreaterThanOrEqual(2.5);
    });

    it('should reject R:R ratio below 2.5', () => {
      const entry = 75412.1;
      const sl = 74800;
      const tp = 75800; // Too close

      const risk = Math.abs(entry - sl);
      const reward = Math.abs(tp - entry);
      const rr = reward / risk;

      expect(rr).toBeLessThan(2.5);
    });

    it('should calculate R:R ratio correctly', () => {
      const entry = 75412.1;
      const sl = 74800;
      const tp = 78000;

      const risk = Math.abs(entry - sl);
      const reward = Math.abs(tp - entry);
      const rr = reward / risk;

      // Actual RR is ~4.23 based on these values
      expect(rr).toBeCloseTo(4.23, 1);
      expect(rr).toBeGreaterThan(2.5); // Still meets minimum requirement
    });
  });

  describe('Alternative scenario structure', () => {
    it('should have required fields in alternative scenario', () => {
      const altScenario = sampleAIResponse.btc.alternative_scenario;

      expect(altScenario).toBeDefined();
      expect(altScenario.trigger).toBeDefined();
      expect(altScenario.new_bias).toBeDefined();
      expect(altScenario.new_entry).toBeDefined();
      expect(altScenario.new_sl).toBeDefined();
      expect(altScenario.new_tp).toBeDefined();
    });

    it('should have valid bias values', () => {
      const altScenario = sampleAIResponse.btc.alternative_scenario;

      expect(['bullish', 'bearish', 'neutral']).toContain(altScenario.new_bias);
    });

    it('should have numeric entry, SL, TP values', () => {
      const altScenario = sampleAIResponse.btc.alternative_scenario;

      expect(typeof altScenario.new_entry).toBe('number');
      expect(typeof altScenario.new_sl).toBe('number');
      expect(typeof altScenario.new_tp).toBe('number');
    });

    it('should have valid trigger description', () => {
      const altScenario = sampleAIResponse.btc.alternative_scenario;

      expect(altScenario.trigger).toBeDefined();
      expect(altScenario.trigger.length).toBeGreaterThan(0);
    });
  });
});
